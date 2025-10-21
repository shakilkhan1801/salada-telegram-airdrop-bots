import { config } from '../config';
import { Logger } from './logger';

export class TelegramNotifyService {
  private static logger = Logger.getInstance();

  /**
   * Mask username for privacy (e.g., "Shahriariwu" -> "Sha***iwu")
   */
  private static maskUsername(username: string | undefined): string {
    if (!username) return '';
    if (username.length < 6) return username; // Show short usernames as is
    return `${username.substring(0, 3)}***${username.substring(username.length - 3)}`;
  }

  /**
   * Format token amount - remove unnecessary trailing zeros
   * Examples: 10.000000 -> 10, 10.5 -> 10.5, 10.123456 -> 10.123456
   */
  private static formatTokenAmount(amount: number): string {
    // If it's a whole number, show without decimals
    if (amount === Math.floor(amount)) {
      return amount.toLocaleString();
    }
    // Otherwise, show with up to 6 decimals but remove trailing zeros
    const formatted = amount.toFixed(6);
    return parseFloat(formatted).toLocaleString();
  }

  static async sendToAdmins(text: string): Promise<{ sent: number; failed: number; errors: string[] }> {
    const token = config.bot.token;
    const adminIds = config.admin.adminIds || [];
    const results = { sent: 0, failed: 0, errors: [] as string[] };

    if (!token || adminIds.length === 0) {
      return results;
    }

    await Promise.allSettled(
      adminIds.map(async (id) => {
        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: id, text, parse_mode: 'HTML', disable_web_page_preview: true })
          });
          if (!res.ok) {
            results.failed++;
            results.errors.push(`${id}:${res.status}`);
          } else {
            results.sent++;
          }
        } catch (e: any) {
          results.failed++;
          results.errors.push(`${id}:${e?.message || 'error'}`);
        }
      })
    );

    return results;
  }

  static async sendToChannel(channelId: string, text: string): Promise<{ success: boolean; error?: string }> {
    const token = config.bot.token;

    if (!token || !channelId) {
      return { success: false, error: 'Missing token or channel ID' };
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: channelId, 
          text, 
          parse_mode: 'HTML', 
          disable_web_page_preview: true 
        })
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        this.logger.error('Failed to send message to channel:', { channelId, status: res.status, error: errorText });
        return { success: false, error: `HTTP ${res.status}: ${errorText}` };
      }
      
      return { success: true };
    } catch (e: any) {
      this.logger.error('Error sending message to channel:', { channelId, error: e?.message });
      return { success: false, error: e?.message || 'Unknown error' };
    }
  }

  static async sendWithdrawalAlert(
    channelId: string,
    userId: string,
    username: string | undefined,
    walletAddress: string,
    points: number,
    tokenAmount: number,
    tokenSymbol: string,
    transactionHash?: string,
    explorerUrl?: string
  ): Promise<void> {
    if (!channelId) return;

    const maskedUsername = username ? `@${this.maskUsername(username)}` : `User ${userId}`;
    const ts = new Date().toLocaleString();
    const walletMasked = walletAddress.length > 10 
      ? `${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}`
      : walletAddress;

    // Generate transaction URL if hash and explorer URL provided
    let txHashLine = '';
    if (transactionHash && explorerUrl) {
      const base = explorerUrl.replace(/\/$/, '');
      const txUrl = base.includes('/tx') 
        ? `${base.replace(/\/?tx\/?$/, '')}/tx/${transactionHash}` 
        : `${base}/tx/${transactionHash}`;
      
      // Extract explorer name from URL (e.g., "BaseScan" from basescan.org)
      const explorerName = base.includes('basescan') ? 'BaseScan' 
        : base.includes('etherscan') ? 'Etherscan'
        : base.includes('bscscan') ? 'BscScan'
        : base.includes('polygonscan') ? 'PolygonScan'
        : 'Explorer';
      
      txHashLine = `🔗 TX Hash: <a href="${txUrl}">🔍 View on ${explorerName}</a>\n`;
    } else if (transactionHash) {
      txHashLine = `🔗 TX Hash: <code>${transactionHash}</code>\n`;
    }

    // SALA Theme - Withdrawal Alert
    const alertText = 
      `✨ <b>${tokenSymbol} WITHDRAWAL SUCCESS</b>\n\n` +
      `👑 <b>User:</b> ${maskedUsername}\n` +
      `💵 <b>Withdrawn:</b> ${this.formatTokenAmount(tokenAmount)} ${tokenSymbol}\n` +
      `💼 <b>Wallet:</b> <code>${walletMasked}</code>\n` +
      txHashLine +
      `🕓 <b>Date:</b> ${ts}\n\n` +
      `🏆 <b>Transaction Confirmed</b>\n` +
      `#withdraw | 💠 ${tokenSymbol} Rewards`;

    await this.sendToChannel(channelId, alertText);
  }

  static async sendTransferAlert(
    channelId: string,
    senderId: string,
    senderUsername: string | undefined,
    receiverId: string,
    receiverUsername: string | undefined,
    amount: number,
    fee: number,
    netAmount: number,
    hash: string
  ): Promise<void> {
    if (!channelId) return;

    const senderDisplay = senderUsername ? `@${this.maskUsername(senderUsername)}` : `User ${senderId}`;
    const receiverDisplay = receiverUsername ? `@${this.maskUsername(receiverUsername)}` : `User ${receiverId}`;
    const ts = new Date().toLocaleString();
    const hashShort = hash && hash.length > 12 ? `${hash.substring(0, 10)}...` : hash;

    // Get token symbol from config (fallback to SALA)
    const tokenSymbol = config.wallet?.tokenSymbol || 'SALA';

    // SALA Theme - Transfer Alert
    const alertText = 
      `👑 <b>${tokenSymbol} POINT TRANSFER SUCCESS</b>\n\n` +
      `🧑‍💼 <b>From:</b> ${senderDisplay}\n` +
      `📨 <b>To:</b> ${receiverDisplay}\n` +
      `🏷️ <b>Amount:</b> ${amount.toLocaleString()} pts\n` +
      `⚖️ <b>Fee:</b> ${fee.toLocaleString()} pts\n` +
      `🎯 <b>Net Received:</b> ${netAmount.toLocaleString()} pts\n` +
      `🪪 <b>TX Hash:</b> <code>${hashShort}</code>\n` +
      `🕰️ <b>Time:</b> ${ts}\n\n` +
      `🥇 <b>Status: Confirmed</b>\n` +
      `#transfer | 💫 ${tokenSymbol} Rewards`;

    await this.sendToChannel(channelId, alertText);
  }
}