import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { ISecurityControlService, IAdminAuthorizationService, IAdminUIService } from '../../interfaces/admin-services.interface';
import { Logger } from '../logger';
import { StorageManager } from '../../storage';
import { SecurityManager } from '../../security';
import { ThreatAnalysis, DeviceFingerprint } from '../../types';

interface IpBlockEntry {
  id: string;
  address: string;
  blockedAt: string;
  blockedBy?: string;
  reason?: string;
  isActive: boolean;
  unblockedAt?: string;
  unblockedBy?: string;
}

/**
 * Service for security control operations
 */
export class SecurityControlService implements ISecurityControlService {
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private readonly security = SecurityManager.getInstance();
  
  constructor(
    private authService: IAdminAuthorizationService,
    private uiService: IAdminUIService
  ) {}

  /**
   * Show security panel
   */
  async showSecurityPanel(ctx: Context): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      const securityOverview = await this.getSecurityOverview();
      const panelText = this.getSecurityPanelText(securityOverview);
      const keyboard = this.uiService.getSecurityPanelKeyboard();

      if (ctx.callbackQuery) {
        await ctx.editMessageText(panelText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } else {
        await ctx.reply(panelText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      }
    } catch (error) {
      this.logger.error('Error showing security panel:', error);
      await ctx.reply('❌ Error loading security panel.');
    }
  }

  /**
   * View security logs
   */
  async viewSecurityLogs(ctx: Context): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      const securityLogs = await this.getRecentSecurityLogs();
      
      if (securityLogs.length === 0) {
        await ctx.reply('📋 No recent security logs found.');
        return;
      }

      const logsText = this.buildSecurityLogsText(securityLogs);
      const keyboard = this.buildSecurityLogsKeyboard();

      if (ctx.callbackQuery) {
        await ctx.editMessageText(logsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } else {
        await ctx.reply(logsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      }
    } catch (error) {
      this.logger.error('Error viewing security logs:', error);
      await ctx.reply('❌ Error loading security logs.');
    }
  }

  /**
   * Block IP address
   */
  async blockIpAddress(ctx: Context, ipAddress: string): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      if (!this.isValidIpAddress(ipAddress)) {
        await ctx.reply('❌ Invalid IP address format.');
        return;
      }

      // Check if IP is already blocked
      const blockedIPs = await this.getBlockedIPs();
      const isAlreadyBlocked = blockedIPs.some(ip => ip.address === ipAddress && ip.isActive);

      if (isAlreadyBlocked) {
        await ctx.reply(`⚠️ IP address ${ipAddress} is already blocked.`);
        return;
      }

      // Add to blocked IPs
      const blockEntry = {
        id: `ip_block_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        address: ipAddress,
        blockedAt: new Date().toISOString(),
        blockedBy: ctx.from?.id?.toString(),
        reason: 'Manually blocked by admin',
        isActive: true
      };

      const blockedIPsData: Record<string, IpBlockEntry> = (await this.storage.get('blocked_ips')) || {};
      blockedIPsData[blockEntry.id] = blockEntry;
      await this.storage.set('blocked_ips', blockedIPsData);

      // Log the action
      await this.logSecurityAction(ctx, 'ip_blocked', {
        ipAddress,
        blockId: blockEntry.id,
        reason: blockEntry.reason
      });

      await ctx.reply(`✅ IP address ${ipAddress} has been blocked.`);
      
      this.logger.info(`IP ${ipAddress} blocked by admin ${ctx.from?.id}`);
    } catch (error) {
      this.logger.error('Error blocking IP address:', error);
      await ctx.reply('❌ Error blocking IP address. Please try again.');
    }
  }

  /**
   * Unblock IP address
   */
  async unblockIpAddress(ctx: Context, ipAddress: string): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      if (!this.isValidIpAddress(ipAddress)) {
        await ctx.reply('❌ Invalid IP address format.');
        return;
      }

      // Find and deactivate the IP block
      const blockedIPsData: Record<string, IpBlockEntry> = (await this.storage.get('blocked_ips')) || {};
      let found = false;

      for (const [blockId, blockData] of Object.entries(blockedIPsData) as [string, IpBlockEntry][]) {
        if (blockData.address === ipAddress && blockData.isActive) {
          blockedIPsData[blockId] = {
            ...blockData,
            isActive: false,
            unblockedAt: new Date().toISOString(),
            unblockedBy: ctx.from?.id?.toString()
          };
          found = true;
          break;
        }
      }

      if (!found) {
        await ctx.reply(`⚠️ IP address ${ipAddress} is not currently blocked.`);
        return;
      }

      await this.storage.set('blocked_ips', blockedIPsData);

      // Log the action
      await this.logSecurityAction(ctx, 'ip_unblocked', {
        ipAddress,
        unblockedAt: new Date().toISOString()
      });

      await ctx.reply(`✅ IP address ${ipAddress} has been unblocked.`);
      
      this.logger.info(`IP ${ipAddress} unblocked by admin ${ctx.from?.id}`);
    } catch (error) {
      this.logger.error('Error unblocking IP address:', error);
      await ctx.reply('❌ Error unblocking IP address. Please try again.');
    }
  }

  /**
   * Show suspicious activity
   */
  async showSuspiciousActivity(ctx: Context): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      const suspiciousActivities = await this.getSuspiciousActivities();
      
      if (suspiciousActivities.length === 0) {
        await ctx.reply('✅ No suspicious activity detected recently.');
        return;
      }

      const activitiesText = this.buildSuspiciousActivitiesText(suspiciousActivities);
      const keyboard = this.buildSuspiciousActivitiesKeyboard();

      if (ctx.callbackQuery) {
        await ctx.editMessageText(activitiesText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } else {
        await ctx.reply(activitiesText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      }
    } catch (error) {
      this.logger.error('Error showing suspicious activity:', error);
      await ctx.reply('❌ Error loading suspicious activity data.');
    }
  }

  /**
   * Perform security scan
   */
  async performSecurityScan(ctx: Context): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      await ctx.reply('🔍 Initiating comprehensive security scan... This may take a few moments.');

      const scanResults = await this.runComprehensiveSecurityScan();
      const resultsText = this.buildSecurityScanResultsText(scanResults);

      await ctx.reply(resultsText, { parse_mode: 'HTML' });

      // Log the scan
      await this.logSecurityAction(ctx, 'security_scan_performed', {
        scanResults: scanResults.summary,
        timestamp: new Date().toISOString()
      });

      this.logger.info(`Security scan performed by admin ${ctx.from?.id}`);
    } catch (error) {
      this.logger.error('Error performing security scan:', error);
      await ctx.reply('❌ Error performing security scan. Please try again.');
    }
  }

  /**
   * Update security settings
   */
  async updateSecuritySettings(ctx: Context): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx, true))) { // Require super admin
        return;
      }

      await ctx.reply(`
⚙️ <b>Security Settings</b>

Current security settings can be updated through the web admin panel. Here are the current key settings:

🛡️ <b>Multi-account Detection:</b> Enabled
🔍 <b>Device Fingerprinting:</b> Enabled
🤖 <b>Bot Detection:</b> Enabled
📊 <b>Behavioral Analysis:</b> Enabled
🚫 <b>IP Blocking:</b> Enabled
⏰ <b>Rate Limiting:</b> Enabled

To modify these settings:
1. Access the web admin panel
2. Navigate to Security → Settings
3. Adjust parameters as needed
4. Save and restart the bot if required

<i>Note: Only super admins can modify security settings.</i>
      `, { parse_mode: 'HTML' });

    } catch (error) {
      this.logger.error('Error showing security settings:', error);
      await ctx.reply('❌ Error loading security settings.');
    }
  }

  /**
   * Export security report
   */
  async exportSecurityReport(ctx: Context): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx, true))) { // Require super admin
        return;
      }

      await ctx.reply('📊 Generating comprehensive security report... This may take a moment.');

      const securityReport = await this.generateSecurityReport();
      const reportSummary = this.buildSecurityReportSummary(securityReport);

      await ctx.reply(reportSummary, { parse_mode: 'HTML' });

      // Log the export
      await this.logSecurityAction(ctx, 'security_report_exported', {
        reportGenerated: true,
        timestamp: new Date().toISOString(),
        dataPoints: Object.keys(securityReport).length
      });

      this.logger.info(`Security report exported by admin ${ctx.from?.id}`);
    } catch (error) {
      this.logger.error('Error exporting security report:', error);
      await ctx.reply('❌ Error generating security report. Please try again.');
    }
  }

  // Private helper methods

  private async getSecurityOverview(): Promise<any> {
    try {
      const threats = await this.getAllThreats();
      const blockedIPs = await this.getBlockedIPs();
      const suspiciousActivities = await this.getSuspiciousActivities();
      const securityLogs = await this.getRecentSecurityLogs(100);

      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      return {
        overview: {
          totalThreats: threats.length,
          criticalThreats: threats.filter(t => t.threatLevel === 'critical').length,
          highThreats: threats.filter(t => t.threatLevel === 'high').length,
          blockedIPs: blockedIPs.filter(ip => ip.isActive).length,
          suspiciousActivities: suspiciousActivities.length,
          recentIncidents: securityLogs.filter(log => new Date(log.timestamp) > last24h).length
        },
        trends: {
          threatsLast24h: threats.filter(t => new Date(t.analysisTimestamp) > last24h).length,
          threatsLast7d: threats.filter(t => new Date(t.analysisTimestamp) > last7d).length,
          incidentsLast24h: securityLogs.filter(log => new Date(log.timestamp) > last24h).length,
          incidentsLast7d: securityLogs.filter(log => new Date(log.timestamp) > last7d).length
        },
        topRisks: threats
          .sort((a, b) => b.overallRiskScore - a.overallRiskScore)
          .slice(0, 3)
          .map(t => ({
            userId: t.userId,
            riskScore: t.overallRiskScore,
            threatLevel: t.threatLevel,
            primaryRisk: t.riskFactors?.[0]?.type || 'unknown'
          }))
      };
    } catch (error) {
      this.logger.error('Error getting security overview:', error);
      return {};
    }
  }

  private getSecurityPanelText(overview: any): string {
    const { overview: stats, trends, topRisks } = overview;

    return `
🛡️ <b>Security Control Panel</b>

📊 <b>Current Status:</b>
• Total Threats: <b>${stats?.totalThreats || 0}</b>
• Critical Threats: <b>${stats?.criticalThreats || 0}</b>
• High-Risk Threats: <b>${stats?.highThreats || 0}</b>
• Blocked IPs: <b>${stats?.blockedIPs || 0}</b>
• Suspicious Activities: <b>${stats?.suspiciousActivities || 0}</b>
• Recent Incidents (24h): <b>${stats?.recentIncidents || 0}</b>

📈 <b>Activity Trends:</b>
• New Threats (24h): <b>${trends?.threatsLast24h || 0}</b>
• New Threats (7d): <b>${trends?.threatsLast7d || 0}</b>
• Security Incidents (24h): <b>${trends?.incidentsLast24h || 0}</b>
• Security Incidents (7d): <b>${trends?.incidentsLast7d || 0}</b>

⚠️ <b>Top Risk Users:</b>
${topRisks?.map((risk: any, index: number) => 
  `${index + 1}. User ${risk.userId} - Risk: ${risk.riskScore.toFixed(1)} (${risk.threatLevel})`
).join('\n') || 'No high-risk users detected'}

🔧 <b>Available Actions:</b>
• View detailed security logs
• Block/unblock IP addresses  
• Monitor suspicious activity
• Run comprehensive security scans
• Export security reports
    `.trim();
  }

  private async getAllThreats(): Promise<ThreatAnalysis[]> {
    try {
      const threatIds = await this.storage.list('security_threats') || [];
      const threats: ThreatAnalysis[] = [];
      
      for (const threatId of threatIds) {
        const threat = await this.storage.get<ThreatAnalysis>('security_threats', threatId);
        if (threat) threats.push(threat);
      }
      
      return threats;
    } catch (error) {
      this.logger.error('Error fetching threats:', error);
      return [];
    }
  }

  private async getBlockedIPs(): Promise<IpBlockEntry[]> {
    try {
      const blockedIPsData: Record<string, IpBlockEntry> = (await this.storage.get('blocked_ips')) || {};
      return Object.values(blockedIPsData);
    } catch (error) {
      this.logger.error('Error getting blocked IPs:', error);
      return [];
    }
  }

  private async getSuspiciousActivities(): Promise<any[]> {
    try {
      const activitiesData = await this.storage.get('suspicious_activities') || {};
      const activities = Array.isArray(activitiesData) ? activitiesData : Object.values(activitiesData);
      
      // Filter recent activities (last 7 days)
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      
      return activities.filter((activity: any) => 
        new Date(activity.timestamp || activity.detectedAt) > weekAgo
      );
    } catch (error) {
      this.logger.error('Error getting suspicious activities:', error);
      return [];
    }
  }

  private async getRecentSecurityLogs(limit: number = 50): Promise<any[]> {
    try {
      const securityLogsData = await this.storage.get('security_logs') || {};
      const logs = Object.values(securityLogsData);
      
      return logs
        .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);
    } catch (error) {
      this.logger.error('Error getting security logs:', error);
      return [];
    }
  }

  private buildSecurityLogsText(logs: any[]): string {
    let text = `📋 <b>Recent Security Logs</b> (${logs.length})\n\n`;
    
    for (const log of logs.slice(0, 10)) {
      const timestamp = new Date(log.timestamp).toLocaleString();
      const action = log.action || log.event || 'Unknown';
      const details = log.details || log.description || 'No details';
      
      text += `🔸 <b>${timestamp}</b>\n`;
      text += `📝 Action: ${action}\n`;
      text += `📄 Details: ${details}\n`;
      if (log.userId) text += `👤 User: ${log.userId}\n`;
      if (log.adminId) text += `👨‍💼 Admin: ${log.adminId}\n`;
      text += `\n`;
    }

    if (logs.length > 10) {
      text += `<i>... and ${logs.length - 10} more entries</i>`;
    }

    return text.trim();
  }

  private buildSecurityLogsKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'Refresh', callback_data: 'admin_security_logs' },
          { text: 'Export Logs', callback_data: 'admin_export_security_logs' }
        ],
        [
          { text: 'Back to Security', callback_data: 'admin_security' }
        ]
      ]
    };
  }

  private buildSuspiciousActivitiesText(activities: any[]): string {
    let text = `⚠️ <b>Suspicious Activities</b> (${activities.length})\n\n`;
    
    for (const activity of activities.slice(0, 10)) {
      const timestamp = new Date(activity.timestamp || activity.detectedAt).toLocaleString();
      const type = activity.type || activity.activityType || 'Unknown';
      const description = activity.description || activity.details || 'No description';
      
      text += `🚨 <b>${type}</b>\n`;
      text += `⏰ Detected: ${timestamp}\n`;
      text += `📄 Description: ${description}\n`;
      if (activity.userId) text += `👤 User: ${activity.userId}\n`;
      if (activity.riskScore) text += `📊 Risk Score: ${activity.riskScore}/100\n`;
      text += `\n`;
    }

    if (activities.length > 10) {
      text += `<i>... and ${activities.length - 10} more activities</i>`;
    }

    return text.trim();
  }

  private buildSuspiciousActivitiesKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'Refresh', callback_data: 'admin_suspicious_activity' },
          { text: 'Deep Scan', callback_data: 'admin_security_scan' }
        ],
        [
          { text: 'Back to Security', callback_data: 'admin_security' }
        ]
      ]
    };
  }

  private async runComprehensiveSecurityScan(): Promise<any> {
    try {
      const startTime = Date.now();
      
      // Get all data for analysis
      const [users, threats, devices, activities] = await Promise.all([
        this.storage.getAllUsers(),
        this.getAllThreats(),
        this.getAllDevices(),
        this.getSuspiciousActivities()
      ]);

      // Perform various security checks
      const scanResults = {
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        summary: {
          usersScanned: users.length,
          threatsFound: threats.length,
          devicesAnalyzed: devices.length,
          suspiciousActivitiesDetected: activities.length,
          criticalIssues: threats.filter(t => t.threatLevel === 'critical').length,
          recommendedActions: [] as string[]
        },
        details: {
          userAnalysis: await this.analyzeUsers(users),
          threatAnalysis: this.analyzeThreatDistribution(threats),
          deviceAnalysis: this.analyzeDeviceFingerprints(devices),
          networkAnalysis: await this.analyzeNetworkActivity()
        }
      };

      // Generate recommendations
      scanResults.summary.recommendedActions = this.generateSecurityRecommendations(scanResults);

      return scanResults;
    } catch (error) {
      this.logger.error('Error running security scan:', error);
      return {
        timestamp: new Date().toISOString(),
        duration: 0,
        summary: { error: 'Scan failed' },
        details: {}
      };
    }
  }

  private buildSecurityScanResultsText(results: any): string {
    const { summary, duration } = results;
    
    return `
🔍 <b>Security Scan Results</b>

⏱️ <b>Scan Duration:</b> ${(duration / 1000).toFixed(1)}s
📊 <b>Summary:</b>
• Users Scanned: <b>${summary.usersScanned || 0}</b>
• Threats Found: <b>${summary.threatsFound || 0}</b>
• Devices Analyzed: <b>${summary.devicesAnalyzed || 0}</b>
• Suspicious Activities: <b>${summary.suspiciousActivitiesDetected || 0}</b>
• Critical Issues: <b>${summary.criticalIssues || 0}</b>

🔧 <b>Recommended Actions:</b>
${summary.recommendedActions?.map((action: string, index: number) => 
  `${index + 1}. ${action}`
).join('\n') || 'No specific actions recommended at this time.'}

<b>Status:</b> ${summary.criticalIssues > 0 ? '⚠️ Attention Required' : '✅ System Secure'}

<i>Scan completed on ${new Date(results.timestamp).toLocaleString()}</i>
    `.trim();
  }

  private async generateSecurityReport(): Promise<any> {
    try {
      const [
        threats,
        blockedIPs, 
        activities,
        logs,
        users,
        devices
      ] = await Promise.all([
        this.getAllThreats(),
        this.getBlockedIPs(),
        this.getSuspiciousActivities(),
        this.getRecentSecurityLogs(1000),
        this.storage.getAllUsers(),
        this.getAllDevices()
      ]);

      return {
        generatedAt: new Date().toISOString(),
        statistics: {
          totalUsers: users.length,
          verifiedUsers: users.filter(u => u.isVerified).length,
          blockedUsers: users.filter(u => u.isBlocked).length,
          threatsDetected: threats.length,
          criticalThreats: threats.filter(t => t.threatLevel === 'critical').length,
          blockedIPs: blockedIPs.filter(ip => ip.isActive).length,
          suspiciousActivities: activities.length,
          securityIncidents: logs.length
        },
        trends: this.analyzeSecurityTrends(logs),
        topRisks: threats
          .sort((a, b) => b.overallRiskScore - a.overallRiskScore)
          .slice(0, 10),
        systemHealth: await this.assessSystemSecurityHealth()
      };
    } catch (error) {
      this.logger.error('Error generating security report:', error);
      return { error: 'Failed to generate report' };
    }
  }

  private buildSecurityReportSummary(report: any): string {
    if (report.error) {
      return `❌ <b>Security Report Generation Failed</b>\n\n${report.error}`;
    }

    const { statistics, systemHealth } = report;
    
    return `
📊 <b>Security Report Summary</b>

📈 <b>Statistics:</b>
• Total Users: <b>${statistics.totalUsers}</b>
• Verified Users: <b>${statistics.verifiedUsers}</b>
• Blocked Users: <b>${statistics.blockedUsers}</b>
• Threats Detected: <b>${statistics.threatsDetected}</b>
• Critical Threats: <b>${statistics.criticalThreats}</b>
• Blocked IPs: <b>${statistics.blockedIPs}</b>
• Suspicious Activities: <b>${statistics.suspiciousActivities}</b>

🏥 <b>System Health Score:</b> <b>${systemHealth?.score || 'N/A'}/100</b>
${systemHealth?.status ? `Status: ${systemHealth.status}` : ''}

<b>Overall Assessment:</b> ${this.getSecurityAssessment(statistics)}

<i>Report generated on ${new Date(report.generatedAt).toLocaleString()}</i>
<i>Full detailed report available through web admin panel.</i>
    `.trim();
  }

  // Helper methods

  private isValidIpAddress(ip: string): boolean {
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
  }

  private async getAllDevices(): Promise<DeviceFingerprint[]> {
    try {
      const deviceIds = await this.storage.list('device_fingerprints') || [];
      const devices: DeviceFingerprint[] = [];
      
      for (const deviceId of deviceIds) {
        const device = await this.storage.get<DeviceFingerprint>('device_fingerprints', deviceId);
        if (device) devices.push(device);
      }
      
      return devices;
    } catch (error) {
      this.logger.error('Error fetching devices:', error);
      return [];
    }
  }

  private async analyzeUsers(users: any[]): Promise<any> {
    // Simple user analysis
    const activeUsers = users.filter(u => {
      const lastActive = new Date(u.lastActive || u.lastActivity || 0);
      const daysSinceActive = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceActive <= 7;
    });

    return {
      total: users.length,
      active: activeUsers.length,
      verified: users.filter(u => u.isVerified).length,
      blocked: users.filter(u => u.isBlocked).length,
      newThisWeek: users.filter(u => {
        const joinedAt = new Date(u.joinedAt || u.createdAt || 0);
        const daysSinceJoined = (Date.now() - joinedAt.getTime()) / (1000 * 60 * 60 * 24);
        return daysSinceJoined <= 7;
      }).length
    };
  }

  private analyzeThreatDistribution(threats: ThreatAnalysis[]): any {
    const threatLevels = ['low', 'medium', 'high', 'critical'];
    const distribution = threatLevels.reduce((acc, level) => {
      acc[level] = threats.filter(t => t.threatLevel === level).length;
      return acc;
    }, {} as any);

    return {
      total: threats.length,
      distribution,
      avgRiskScore: threats.length > 0 ? 
        threats.reduce((sum, t) => sum + t.overallRiskScore, 0) / threats.length : 0
    };
  }

  private analyzeDeviceFingerprints(devices: DeviceFingerprint[]): any {
    return {
      total: devices.length,
      blocked: devices.filter(d => (d as any).isBlocked).length,
      flagged: devices.filter((d: any) => d.flaggedAt).length,
      uniqueFingerprints: new Set(devices.map((d: any) => d.fingerprint)).size
    };
  }

  private async analyzeNetworkActivity(): Promise<any> {
    try {
      const blockedIPs = await this.getBlockedIPs();
      const securityLogs = await this.getRecentSecurityLogs(500);
      
      const ipActivity = securityLogs
        .filter(log => log.ipAddress)
        .reduce((acc: Record<string, number>, log) => {
          const ip = log.ipAddress as string;
          acc[ip] = (acc[ip] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

      return {
        totalBlockedIPs: blockedIPs.filter(ip => ip.isActive).length,
        activeIPAddresses: Object.keys(ipActivity).length,
        suspiciousIPs: Object.entries(ipActivity)
          .filter(([, count]: [string, any]) => count > 10)
          .length
      };
    } catch (error) {
      this.logger.error('Error analyzing network activity:', error);
      return {};
    }
  }

  private generateSecurityRecommendations(scanResults: any): string[] {
    const recommendations: string[] = [];
    const { summary } = scanResults;

    if (summary.criticalIssues > 0) {
      recommendations.push('Review and address critical security threats immediately');
    }

    if (summary.suspiciousActivitiesDetected > 10) {
      recommendations.push('Consider tightening security parameters for user verification');
    }

    if (recommendations.length === 0) {
      recommendations.push('Continue monitoring - no immediate security actions required');
    }

    return recommendations;
  }

  private analyzeSecurityTrends(logs: any[]): any {
    const last24h = logs.filter(log => {
      const logTime = new Date(log.timestamp);
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return logTime > dayAgo;
    });

    const last7d = logs.filter(log => {
      const logTime = new Date(log.timestamp);
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return logTime > weekAgo;
    });

    return {
      incidentsLast24h: last24h.length,
      incidentsLast7d: last7d.length,
      trendDirection: last24h.length > last7d.length / 7 ? 'increasing' : 'stable'
    };
  }

  private async assessSystemSecurityHealth(): Promise<any> {
    try {
      const threats = await this.getAllThreats();
      const activities = await this.getSuspiciousActivities();
      
      let score = 100;
      
      // Deduct points for threats
      score -= threats.filter(t => t.threatLevel === 'critical').length * 10;
      score -= threats.filter(t => t.threatLevel === 'high').length * 5;
      score -= Math.min(activities.length, 20); // Max 20 points for activities
      
      score = Math.max(0, score);
      
      let status = 'Excellent';
      if (score < 70) status = 'Good';
      if (score < 50) status = 'Fair';
      if (score < 30) status = 'Poor';
      
      return { score, status };
    } catch (error) {
      this.logger.error('Error assessing security health:', error);
      return { score: 0, status: 'Unknown' };
    }
  }

  private getSecurityAssessment(statistics: any): string {
    const criticalRatio = statistics.criticalThreats / Math.max(statistics.totalUsers, 1);
    const blockedRatio = statistics.blockedUsers / Math.max(statistics.totalUsers, 1);
    
    if (criticalRatio > 0.1 || blockedRatio > 0.2) {
      return '⚠️ High security risk detected - immediate attention required';
    } else if (criticalRatio > 0.05 || blockedRatio > 0.1) {
      return '🔶 Moderate security concerns - monitor closely';
    } else {
      return '✅ Security posture is healthy';
    }
  }

  private async logSecurityAction(ctx: Context, action: string, metadata: any): Promise<void> {
    try {
      const adminId = ctx.from?.id?.toString();
      if (!adminId) return;

      const logEntry = {
        id: `security_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        adminId,
        action,
        metadata,
        timestamp: new Date().toISOString()
      };

      const securityLogs: Record<string, any> = (await this.storage.get('security_logs')) || {};
      securityLogs[logEntry.id] = logEntry;
      await this.storage.set('security_logs', securityLogs);
    } catch (error) {
      this.logger.error('Error logging security action:', error);
    }
  }
}