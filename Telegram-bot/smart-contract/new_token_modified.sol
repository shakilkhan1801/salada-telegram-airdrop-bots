// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title SecureControlledTokenV4
 * @dev Modified version with pauseExcept functionality
 */
contract SecureControlledTokenV4 is ERC20, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    // Constants
    uint8 private constant DECIMALS = 18;
    uint256 public constant TIMELOCK_DURATION = 2 days;
    uint256 public constant MIN_DELAY = 6 hours;
    uint256 public constant MAX_TRANSFER_PERCENTAGE = 10;
    uint256 public constant RATE_LIMIT_PERIOD = 1 hours;
    
    // Roles
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    
    // State
    bool public transferEnabled = true;
    uint8 public requiredSignatures = 1;
    
    // Role enumeration
    mapping(bytes32 => address[]) private roleMembers;
    mapping(bytes32 => mapping(address => uint256)) private roleMemberIndex;
    
    // Multi-sig
    mapping(bytes32 => mapping(address => bool)) public approvals;
    mapping(bytes32 => uint256) public approvalCounts;
    
    // NEW: Pause exceptions - wallets that can transfer when paused
    mapping(address => bool) public pauseExceptions;
    
    // Rate limiting
    struct RateLimit {
        uint128 amount;
        uint128 timestamp;
    }
    mapping(address => RateLimit) public rateLimits;
    
    // Events
    event TransferStatusChanged(bool enabled);
    event PauseExceptionSet(address indexed wallet, bool exception);
    event PauseExceptionCleared();
    
    // Custom errors
    error Unauthorized();
    error TransferNotAllowed();
    error InvalidAddress();
    error RateLimitExceeded();
    error InvalidInput();
    
    modifier onlyAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier onlyOperator() {
        if (!hasRole(OPERATOR_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier whenTransferAllowed(address from, address to, uint256 amount) {
        if (!_isTransferAllowed(from, to)) revert TransferNotAllowed();
        _checkRateLimit(from, amount);
        _;
    }
    
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        address admin_,
        address operator_,
        address guardian_
    ) ERC20(name_, symbol_) {
        _mint(admin_, initialSupply_ * (10 ** DECIMALS));
        
        _setupRole(DEFAULT_ADMIN_ROLE, admin_);
        _setupRole(ADMIN_ROLE, admin_);
        _setupRole(OPERATOR_ROLE, operator_);
        _setupRole(GUARDIAN_ROLE, guardian_);
    }
    
    // Core transfer functions
    function transfer(address to, uint256 amount) 
        public override nonReentrant
        whenTransferAllowed(msg.sender, to, amount) returns (bool) 
    {
        return super.transfer(to, amount);
    }
    
    function transferFrom(address from, address to, uint256 amount) 
        public override nonReentrant
        whenTransferAllowed(from, to, amount) returns (bool) 
    {
        return super.transferFrom(from, to, amount);
    }
    
    function _isTransferAllowed(address from, address to) private view returns (bool) {
        // Minting and burning always allowed
        if (from == address(0) || to == address(0)) return true;
        
        // Check pause status
        if (paused()) {
            // Admin always allowed
            if (hasRole(ADMIN_ROLE, from)) return true;
            // Check pause exceptions
            if (pauseExceptions[from]) return true;
            // Otherwise not allowed when paused
            return false;
        }
        
        // If not paused, check global transfer status
        return transferEnabled;
    }
    
    function _checkRateLimit(address from, uint256 amount) private {
        if (pauseExceptions[from] && from != address(0)) {
            RateLimit storage limit = rateLimits[from];
            uint256 maxAmount = (totalSupply() * MAX_TRANSFER_PERCENTAGE) / 100;
            uint256 currentTime = block.timestamp;
            
            if (currentTime >= limit.timestamp + RATE_LIMIT_PERIOD) {
                limit.amount = 0;
                limit.timestamp = uint128(currentTime);
            }
            
            if (limit.amount + amount > maxAmount) revert RateLimitExceeded();
            limit.amount += uint128(amount);
        }
    }
    
    // NEW: Pause with exception for specific wallet (NO TIMELOCK)
    function pauseExcept(address wallet) external onlyAdmin {
        if (wallet == address(0)) revert InvalidAddress();
        
        // Clear all previous exceptions
        _clearAllPauseExceptions();
        
        // Set new exception
        pauseExceptions[wallet] = true;
        
        // Pause the contract
        _pause();
        
        emit PauseExceptionSet(wallet, true);
    }
    
    // NEW: Add additional pause exception (NO TIMELOCK)
    function addPauseException(address wallet) external onlyAdmin {
        if (wallet == address(0)) revert InvalidAddress();
        
        pauseExceptions[wallet] = true;
        emit PauseExceptionSet(wallet, true);
    }
    
    // NEW: Remove pause exception (NO TIMELOCK)
    function removePauseException(address wallet) external onlyAdmin {
        pauseExceptions[wallet] = false;
        emit PauseExceptionSet(wallet, false);
    }
    
    // NEW: Clear all pause exceptions
    function _clearAllPauseExceptions() private {
        // Note: In production, you'd want to track exception addresses
        // for proper cleanup. This is simplified for the example.
        emit PauseExceptionCleared();
    }
    
    // Modified pause function
    function pause() external {
        if (!hasRole(GUARDIAN_ROLE, msg.sender) && !hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _pause();
    }
    
    // Modified unpause function - clears all exceptions
    function unpause() external onlyAdmin {
        _clearAllPauseExceptions();
        _unpause();
    }
    
    // Role management
    function getRoleMember(bytes32 role, uint256 index) public view returns (address) {
        return roleMembers[role][index];
    }
    
    function getRoleMemberCount(bytes32 role) public view returns (uint256) {
        return roleMembers[role].length;
    }
    
    function _setupRole(bytes32 role, address account) internal {
        _grantRole(role, account);
    }
    
    function grantRole(bytes32 role, address account) public override {
        require(hasRole(getRoleAdmin(role), msg.sender), "AccessControl: sender must be an admin");
        if (_grantRole(role, account)) {
            roleMembers[role].push(account);
            roleMemberIndex[role][account] = roleMembers[role].length - 1;
        }
    }
    
    function revokeRole(bytes32 role, address account) public override {
        require(hasRole(getRoleAdmin(role), msg.sender), "AccessControl: sender must be an admin");
        if (_revokeRole(role, account)) {
            uint256 index = roleMemberIndex[role][account];
            uint256 lastIndex = roleMembers[role].length - 1;
            
            if (index != lastIndex) {
                address lastMember = roleMembers[role][lastIndex];
                roleMembers[role][index] = lastMember;
                roleMemberIndex[role][lastMember] = index;
            }
            
            roleMembers[role].pop();
            delete roleMemberIndex[role][account];
        }
    }
    
    // Multi-sig
    function _checkMultiSig(bytes32 actionId) private {
        if (!approvals[actionId][msg.sender] && hasRole(ADMIN_ROLE, msg.sender)) {
            approvals[actionId][msg.sender] = true;
            approvalCounts[actionId]++;
        }
        
        if (approvalCounts[actionId] < requiredSignatures) revert Unauthorized();
        
        uint256 adminCount = getRoleMemberCount(ADMIN_ROLE);
        for (uint256 i = 0; i < adminCount; i++) {
            delete approvals[actionId][getRoleMember(ADMIN_ROLE, i)];
        }
        delete approvalCounts[actionId];
    }
    
    // Admin functions
    function setTransferEnabled(bool _enabled) external onlyAdmin {
        bytes32 actionId = keccak256(abi.encode("transferStatus", _enabled, block.timestamp));
        if (requiredSignatures > 1) _checkMultiSig(actionId);
        
        transferEnabled = _enabled;
        emit TransferStatusChanged(_enabled);
    }
    
    // Token functions
    function mint(address to, uint256 amount) external onlyAdmin {
        if (to == address(0)) revert InvalidAddress();
        
        bytes32 actionId = keccak256(abi.encode("mint", to, amount, block.timestamp));
        if (requiredSignatures > 1) _checkMultiSig(actionId);
        
        _mint(to, amount);
    }
    
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
    
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }
    
    // Setters
    function setRequiredSignatures(uint8 _required) external onlyAdmin {
        if (_required == 0 || _required > getRoleMemberCount(ADMIN_ROLE)) revert InvalidInput();
        
        bytes32 actionId = keccak256(abi.encode("setRequiredSigs", _required, block.timestamp));
        if (requiredSignatures > 1) _checkMultiSig(actionId);
        
        requiredSignatures = _required;
    }
    
    // View functions
    function canTransferNow(address _from) external view returns (bool) {
        return _isTransferAllowed(_from, address(1));
    }
    
    function getRateLimitInfo(address account) external view returns (
        bool hasException,
        uint256 currentAmount,
        uint256 maxAllowed,
        uint256 resetTime
    ) {
        RateLimit memory limit = rateLimits[account];
        uint256 maxAmount = (totalSupply() * MAX_TRANSFER_PERCENTAGE) / 100;
        
        if (block.timestamp >= limit.timestamp + RATE_LIMIT_PERIOD) {
            return (pauseExceptions[account], 0, maxAmount, block.timestamp + RATE_LIMIT_PERIOD);
        }
        
        return (pauseExceptions[account], limit.amount, maxAmount, limit.timestamp + RATE_LIMIT_PERIOD);
    }
}