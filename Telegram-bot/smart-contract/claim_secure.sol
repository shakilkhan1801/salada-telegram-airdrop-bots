// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title SecureTokenClaim
 * @dev Enhanced claim contract with timelock for rescue operations
 */
contract SecureTokenClaim is Ownable, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    IERC20 public token;
    address public signerAddress;
    
    // Claim limits
    uint256 public minimumClaimAmount;
    uint256 public maximumClaimAmount;
    
    // Statistics
    uint256 public totalClaimed;
    
    // User data
    mapping(address => uint256) public lastNonceUsed;
    mapping(address => uint256) public totalClaimedByUser;
    mapping(address => uint256) public claimCount;
    
    // NEW: Timelock for rescue operations
    uint256 public constant RESCUE_DELAY = 3 days;
    uint256 public pendingRescueTime;
    address public pendingRescueTo;
    uint256 public pendingRescueAmount;
    
    // NEW: Multi-sig for emergency
    address public guardian;
    bool public guardianApproved;
    
    // Events
    event Claimed(address indexed user, uint256 amount, uint256 nonce, uint256 timestamp);
    event TokenUpdated(address indexed oldToken, address indexed newToken);
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);
    event RescueInitiated(address indexed to, uint256 amount, uint256 executeTime);
    event RescueExecuted(address indexed to, uint256 amount);
    event RescueCancelled();
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event GuardianApproval(bool approved);

    constructor(
        address _token,
        address _signer,
        address initialOwner,
        address _guardian,
        uint256 _minimumClaimAmount,
        uint256 _maximumClaimAmount
    ) Ownable(initialOwner) {
        require(_token != address(0), "Invalid token address");
        require(_signer != address(0), "Invalid signer address");
        require(_guardian != address(0), "Invalid guardian address");
        require(_minimumClaimAmount > 0, "Invalid minimum amount");
        require(_maximumClaimAmount > _minimumClaimAmount, "Invalid maximum amount");
        
        token = IERC20(_token);
        signerAddress = _signer;
        guardian = _guardian;
        minimumClaimAmount = _minimumClaimAmount;
        maximumClaimAmount = _maximumClaimAmount;
    }

    /**
     * @dev Claim tokens with signature verification
     */
    function claim(
        uint256 amount,
        uint256 nonce,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        require(amount >= minimumClaimAmount, "Amount below minimum");
        require(amount <= maximumClaimAmount, "Amount exceeds maximum");
        require(nonce > lastNonceUsed[msg.sender], "Nonce already used");
        require(token.balanceOf(address(this)) >= amount, "Insufficient contract balance");

        // Verify signature
        bytes32 hash = keccak256(abi.encode(msg.sender, amount, nonce)).toEthSignedMessageHash();
        address recovered = hash.recover(signature);
        require(recovered == signerAddress, "Invalid signature");

        // Update state
        lastNonceUsed[msg.sender] = nonce;
        totalClaimedByUser[msg.sender] += amount;
        claimCount[msg.sender] += 1;
        totalClaimed += amount;

        // Transfer tokens
        require(token.transfer(msg.sender, amount), "Transfer failed");

        emit Claimed(msg.sender, amount, nonce, block.timestamp);
    }

    /**
     * @dev Initiate rescue with timelock (owner only)
     */
    function initiateRescue(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid rescue address");
        require(amount > 0 && amount <= token.balanceOf(address(this)), "Invalid amount");
        
        pendingRescueTo = to;
        pendingRescueAmount = amount;
        pendingRescueTime = block.timestamp + RESCUE_DELAY;
        guardianApproved = false;
        
        emit RescueInitiated(to, amount, pendingRescueTime);
    }
    
    /**
     * @dev Guardian approval for rescue
     */
    function approveRescue() external {
        require(msg.sender == guardian, "Only guardian");
        require(pendingRescueTime > 0, "No pending rescue");
        
        guardianApproved = true;
        emit GuardianApproval(true);
    }
    
    /**
     * @dev Execute rescue after timelock
     */
    function executeRescue() external onlyOwner {
        require(pendingRescueTime > 0, "No pending rescue");
        require(block.timestamp >= pendingRescueTime, "Timelock not expired");
        require(guardianApproved, "Guardian approval required");
        
        address to = pendingRescueTo;
        uint256 amount = pendingRescueAmount;
        
        // Reset
        pendingRescueTime = 0;
        pendingRescueTo = address(0);
        pendingRescueAmount = 0;
        guardianApproved = false;
        
        require(token.transfer(to, amount), "Rescue transfer failed");
        emit RescueExecuted(to, amount);
    }
    
    /**
     * @dev Cancel pending rescue
     */
    function cancelRescue() external {
        require(msg.sender == owner() || msg.sender == guardian, "Unauthorized");
        
        pendingRescueTime = 0;
        pendingRescueTo = address(0);
        pendingRescueAmount = 0;
        guardianApproved = false;
        
        emit RescueCancelled();
    }
    
    /**
     * @dev Update guardian
     */
    function updateGuardian(address _guardian) external onlyOwner {
        require(_guardian != address(0), "Invalid guardian");
        address oldGuardian = guardian;
        guardian = _guardian;
        emit GuardianUpdated(oldGuardian, _guardian);
    }

    /**
     * @dev Update signer address
     */
    function updateSigner(address _signer) external onlyOwner {
        require(_signer != address(0), "Invalid signer");
        address oldSigner = signerAddress;
        signerAddress = _signer;
        emit SignerUpdated(oldSigner, _signer);
    }

    /**
     * @dev Emergency pause
     */
    function pause() external {
        require(msg.sender == owner() || msg.sender == guardian, "Unauthorized");
        _pause();
    }

    /**
     * @dev Unpause
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Get claimable balance
     */
    function getClaimableBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /**
     * @dev Get user info
     */
    function getUserInfo(address user) external view returns (
        uint256 lastNonce,
        uint256 totalClaimedAmount,
        uint256 userClaimCount
    ) {
        return (
            lastNonceUsed[user],
            totalClaimedByUser[user],
            claimCount[user]
        );
    }
    
    /**
     * @dev Get rescue info
     */
    function getRescueInfo() external view returns (
        bool hasPendingRescue,
        address rescueTo,
        uint256 rescueAmount,
        uint256 rescueTime,
        bool isApproved
    ) {
        return (
            pendingRescueTime > 0,
            pendingRescueTo,
            pendingRescueAmount,
            pendingRescueTime,
            guardianApproved
        );
    }
}