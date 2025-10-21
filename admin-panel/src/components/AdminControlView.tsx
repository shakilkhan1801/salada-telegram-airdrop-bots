import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const apiBase =
  (import.meta.env.VITE_API_BASE as string) ||
  (typeof window !== "undefined" ? `${window.location.origin}/api/admin` : "/api/admin");

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-cache" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${apiBase}${path}`, {
    cache: "no-store",
    headers,
    credentials: "include",
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

function stripEmojis(s: string) {
  return String(s || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE0F}\u200D]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function taskHasUrl(t: any): boolean {
  const btnHasUrl = Array.isArray(t?.buttons)
    ? t.buttons.some((b: any) => b?.action === 'open_url' && (b?.url || !b?.callback))
    : false;
  return !!(t?.metadata?.targetUrl) || btnHasUrl;
}

export default function AdminControlView({ canManageTasks }: { canManageTasks: boolean }) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [urlMap, setUrlMap] = useState<Record<string, string>>({});
  const [pointsMap, setPointsMap] = useState<Record<string, number>>({});
  const [autoApproveMap, setAutoApproveMap] = useState<Record<string, boolean>>({});

  const [changedUrls, setChangedUrls] = useState<Set<string>>(new Set());
  const [changedPoints, setChangedPoints] = useState<Set<string>>(new Set());
  const [changedAutoApprove, setChangedAutoApprove] = useState<Set<string>>(new Set());

  const [savingUrls, setSavingUrls] = useState(false);
  const [savingPoints, setSavingPoints] = useState(false);
  const [savingAutoApprove, setSavingAutoApprove] = useState(false);

  const [botOnline, setBotOnline] = useState<boolean | null>(null);
  const [maintenanceMode, setMaintenanceMode] = useState<boolean | null>(null);
  const [maintDuration, setMaintDuration] = useState<string>("");
  const [maintReason, setMaintReason] = useState<string>("");
  const [savingStatus, setSavingStatus] = useState(false);

  const [minWithdraw, setMinWithdraw] = useState<string>("");
  const [conversionRate, setConversionRate] = useState<string>("");
  const [requireChannelJoin, setRequireChannelJoin] = useState<boolean>(false);
  const [requiredChannelId, setRequiredChannelId] = useState<string>("");
  const [withdrawAlertChannel, setWithdrawAlertChannel] = useState<string>("");
  const [savingWithdraw, setSavingWithdraw] = useState(false);

  const [transferEnabled, setTransferEnabled] = useState<boolean>(false);
  const [transferMin, setTransferMin] = useState<string>("");
  const [transferMax, setTransferMax] = useState<string>("");
  const [transferDailyMax, setTransferDailyMax] = useState<string>("");
  const [transferFee, setTransferFee] = useState<string>("");
  const [transferDailyLimit, setTransferDailyLimit] = useState<string>("");
  const [transferRequireConfirm, setTransferRequireConfirm] = useState<boolean>(true);
  const [savingTransfer, setSavingTransfer] = useState(false);

  const [walletApps, setWalletApps] = useState<Record<string, boolean>>({});
  const [walletQrDailyLimit, setWalletQrDailyLimit] = useState<string>("");
  const [savingWallet, setSavingWallet] = useState(false);

  const [captchaMiniappEnabled, setCaptchaMiniappEnabled] = useState<boolean>(true);
  const [captchaSvgEnabled, setCaptchaSvgEnabled] = useState<boolean>(true);
  const [captchaRequireAtLeastOne, setCaptchaRequireAtLeastOne] = useState<boolean>(false);
  const [captchaForExistingUsers, setCaptchaForExistingUsers] = useState<boolean>(false);
  const [captchaSessionTimeout, setCaptchaSessionTimeout] = useState<string>("");
  const [captchaMaxAttempts, setCaptchaMaxAttempts] = useState<string>("");
  const [savingCaptcha, setSavingCaptcha] = useState(false);

  const [autoApprove, setAutoApprove] = useState<boolean>(false);
  const [savingTaskSettings, setSavingTaskSettings] = useState(false);

  const [bcChainId, setBcChainId] = useState<string>("");
  const [bcRpcUrl, setBcRpcUrl] = useState<string>("");
  const [bcExplorerUrl, setBcExplorerUrl] = useState<string>("");
  const [bcConfirmations, setBcConfirmations] = useState<string>("");
  const [bcTokenSymbol, setBcTokenSymbol] = useState<string>("");
  const [bcTokenDecimals, setBcTokenDecimals] = useState<string>("");
  const [bcTokenContract, setBcTokenContract] = useState<string>("");
  const [bcClaimContract, setBcClaimContract] = useState<string>("");
  const [savingBlockchain, setSavingBlockchain] = useState(false);

  const [expCollection, setExpCollection] = useState<string>("users");
  const [expFormat, setExpFormat] = useState<"json" | "csv">("csv");
  const [expFilter, setExpFilter] = useState<string>("");
  const [expProjection, setExpProjection] = useState<string>("");
  const [expSort, setExpSort] = useState<string>("");
  const [expLimit, setExpLimit] = useState<string>("1000");
  const [exporting, setExporting] = useState(false);
  const [exportingUsers, setExportingUsers] = useState(false);

  const [udeEnabled, setUdeEnabled] = useState<boolean>(false);
  const [udeInterval, setUdeInterval] = useState<string>('1h');
  const [udeRunOnStart, setUdeRunOnStart] = useState<boolean>(false);
  const [udeRunning, setUdeRunning] = useState<boolean>(false);
  const [udeLastExport, setUdeLastExport] = useState<string>('');
  const [udeNextRun, setUdeNextRun] = useState<string>('');
  const [savingUde, setSavingUde] = useState(false);
  const [forcingUde, setForcingUde] = useState(false);

  const [referralBonus, setReferralBonus] = useState<string>("");
  const [referralWelcomeBonus, setReferralWelcomeBonus] = useState<string>("");
  const [referralWelcomeBonusEnabled, setReferralWelcomeBonusEnabled] = useState<boolean>(true);
  const [referralCodeLength, setReferralCodeLength] = useState<string>("");
  const [referralTaskThreshold, setReferralTaskThreshold] = useState<string>("");
  const [savingReferral, setSavingReferral] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [tasksRes, statusRes, withdrawRes, transferRes, walletRes, captchaRes, taskSettingsRes, walletConfRes, autoRes, referralRes]: any = await Promise.all([
        api(`/tasks`),
        api(`/system/bot-status`),
        api(`/system/withdraw-settings`),
        api(`/system/transfer-settings`),
        api(`/system/wallet-support`),
        api(`/system/captcha-settings`),
        api(`/system/task-settings`),
        api(`/system/wallet-config`),
        api(`/system/user-data-export`),
        api(`/system/referral-settings`),
      ]);

      const au = (autoRes as any)?.data;
      if (au) {
        setUdeEnabled(!!(au.settings?.enabled));
        setUdeInterval(String(au.settings?.interval || '1h'));
        setUdeRunOnStart(!!(au.settings?.runOnStart));
        const st = au.status || {};
        setUdeRunning(!!st.running);
        setUdeLastExport(String(st.lastExport || au.health?.lastExport || ''));
        setUdeNextRun(String(st.nextRun || ''));
      }
      const rows: any[] = tasksRes.data || [];
      setTasks(rows);
      const urls: Record<string, string> = {};
      const pts: Record<string, number> = {};
      const autoApp: Record<string, boolean> = {};
      for (const t of rows) {
        const btnUrl = Array.isArray(t.buttons)
          ? (t.buttons.find((b: any) => b?.action === 'open_url' && b?.url)?.url || '')
          : '';
        urls[t.id] = t?.metadata?.targetUrl || btnUrl || "";
        pts[t.id] = typeof t.points === "number" ? t.points : 0;
        autoApp[t.id] = !!(t?.validation?.autoApprove);
      }
      setUrlMap(urls);
      setPointsMap(pts);
      setAutoApproveMap(autoApp);
      setChangedUrls(new Set());
      setChangedPoints(new Set());
      setChangedAutoApprove(new Set());

      const st = statusRes?.data;
      setBotOnline(st ? !st.isBotOffline : null);
      setMaintenanceMode(st ? !!st.isMaintenanceMode : null);
      setMaintDuration(st?.expectedDuration || "");
      setMaintReason(st?.reason || "");

      const wd = withdrawRes?.data;
      if (wd) {
        setMinWithdraw(String(wd.minWithdraw ?? ""));
        setConversionRate(String(wd.conversionRate ?? ""));
        setRequireChannelJoin(!!wd.requireChannelJoinForWithdrawal);
        setRequiredChannelId(String(wd.requiredChannelId ?? ""));
        setWithdrawAlertChannel(String(wd.withdrawAlertChannelId ?? ""));
      }

      const tr = transferRes?.data;
      if (tr) {
        setTransferEnabled(!!tr.enabled);
        setTransferMin(String(tr.minAmount ?? ""));
        setTransferMax(String(tr.maxAmount ?? ""));
        setTransferDailyMax(String(tr.maxDailyAmount ?? ""));
        setTransferFee(String(tr.feePercentage ?? ""));
        setTransferDailyLimit(String(tr.dailyLimit ?? ""));
        setTransferRequireConfirm(!!tr.requireConfirmation);
      }

      const ws = walletRes?.data;
      if (ws?.apps) setWalletApps(ws.apps);
      if (ws?.qr) setWalletQrDailyLimit(String(ws.qr.dailyLimit ?? ""));

      const cp = captchaRes?.data;
      if (cp) {
        setCaptchaMiniappEnabled(!!cp.miniappEnabled);
        setCaptchaSvgEnabled(!!cp.svgEnabled);
        setCaptchaRequireAtLeastOne(!!cp.requireAtLeastOne);
        setCaptchaForExistingUsers(!!cp.forExistingUsers);
        setCaptchaSessionTimeout(String(cp.sessionTimeout ?? ""));
        setCaptchaMaxAttempts(String(cp.maxAttempts ?? ""));
      }

      const ts = taskSettingsRes?.data;
      if (ts) setAutoApprove(!!ts.autoApproveSubmissions);

      const wc = walletConfRes?.data;
      if (wc) {
        const n = wc.network || {};
        const c = wc.contracts || {};
        const t = wc.token || {};
        setBcChainId(String(n.chainId ?? ""));
        setBcRpcUrl(String(n.rpcUrl ?? ""));
        setBcExplorerUrl(String(n.explorerUrl ?? ""));
        setBcConfirmations(String(n.confirmationsToWait ?? ""));
        setBcTokenContract(String(c.tokenContractAddress ?? ""));
        setBcClaimContract(String(c.claimContractAddress ?? ""));
        setBcTokenSymbol(String(t.tokenSymbol ?? ""));
        setBcTokenDecimals(String(t.tokenDecimals ?? ""));
      }

      const ref = referralRes?.data;
      if (ref) {
        setReferralBonus(String(ref.referralBonus ?? ""));
        setReferralWelcomeBonus(String(ref.referralWelcomeBonus ?? ""));
        setReferralWelcomeBonusEnabled(!!ref.referralWelcomeBonusEnabled);
        setReferralCodeLength(String(ref.codeLength ?? ""));
        setReferralTaskThreshold(String(ref.taskThreshold ?? ""));
      }
    } catch {
      toast.error("Failed to load tasks/status");
    } finally {
      setLoading(false);
    }
  }

  async function saveTaskSettings() {
    setSavingTaskSettings(true);
    try {
      const res: any = await api(`/system/task-settings`, { method: 'POST', body: JSON.stringify({ autoApproveSubmissions: !!autoApprove }) });
      setAutoApprove(!!res?.data?.autoApproveSubmissions);
      toast.success('Task setting saved');
    } catch {
      toast.error('Failed to save task setting');
    } finally {
      setSavingTaskSettings(false);
    }
  }

  async function saveBotStatus() {
    if (botOnline === null && maintenanceMode === null) return;
    setSavingStatus(true);
    try {
      const body: any = {};
      if (botOnline !== null) body.botOnline = botOnline;
      if (maintenanceMode !== null) {
        body.maintenanceMode = maintenanceMode;
        body.duration = maintDuration || undefined;
        body.reason = maintReason || undefined;
      }
      const res: any = await api(`/system/bot-status`, { method: 'POST', body: JSON.stringify(body) });
      const st = res?.data;
      setBotOnline(st ? !st.isBotOffline : botOnline);
      setMaintenanceMode(st ? !!st.isMaintenanceMode : maintenanceMode);
      toast.success('Bot status saved');
    } catch {
      toast.error('Failed to save bot status');
    } finally {
      setSavingStatus(false);
    }
  }

  async function saveWithdrawSettings() {
    setSavingWithdraw(true);
    try {
      const body: any = {};
      if (minWithdraw !== "") body.minWithdraw = Number(minWithdraw);
      if (conversionRate !== "") body.conversionRate = Number(conversionRate);
      body.requireChannelJoinForWithdrawal = requireChannelJoin;
      body.requiredChannelId = requiredChannelId;
      body.withdrawAlertChannelId = withdrawAlertChannel;
      const res: any = await api(`/system/withdraw-settings`, { method: 'POST', body: JSON.stringify(body) });
      const wd = res?.data;
      if (wd) {
        setMinWithdraw(String(wd.minWithdraw ?? ""));
        setConversionRate(String(wd.conversionRate ?? ""));
        setRequireChannelJoin(!!wd.requireChannelJoinForWithdrawal);
        setRequiredChannelId(String(wd.requiredChannelId ?? ""));
        setWithdrawAlertChannel(String(wd.withdrawAlertChannelId ?? ""));
      }
      toast.success('Withdrawal settings saved');
    } catch {
      toast.error('Failed to save withdrawal settings');
    } finally {
      setSavingWithdraw(false);
    }
  }

  async function saveTransferSettings() {
    setSavingTransfer(true);
    try {
      const body: any = {
        enabled: !!transferEnabled,
        requireConfirmation: !!transferRequireConfirm,
      };
      if (transferMin !== "") body.minAmount = Number(transferMin);
      if (transferMax !== "") body.maxAmount = Number(transferMax);
      if (transferDailyMax !== "") body.maxDailyAmount = Number(transferDailyMax);
      if (transferFee !== "") body.feePercentage = Number(transferFee);
      if (transferDailyLimit !== "") body.dailyLimit = Number(transferDailyLimit);
      const res: any = await api(`/system/transfer-settings`, { method: 'POST', body: JSON.stringify(body) });
      const tr = res?.data;
      if (tr) {
        setTransferEnabled(!!tr.enabled);
        setTransferMin(String(tr.minAmount ?? ""));
        setTransferMax(String(tr.maxAmount ?? ""));
        setTransferDailyMax(String(tr.maxDailyAmount ?? ""));
        setTransferFee(String(tr.feePercentage ?? ""));
        setTransferDailyLimit(String(tr.dailyLimit ?? ""));
        setTransferRequireConfirm(!!tr.requireConfirmation);
      }
      toast.success('Transfer settings saved');
    } catch {
      toast.error('Failed to save transfer settings');
    } finally {
      setSavingTransfer(false);
    }
  }

  async function saveWalletSupport() {
    setSavingWallet(true);
    try {
      const body: any = { apps: walletApps };
      if (walletQrDailyLimit !== "") body.qr = { dailyLimit: Number(walletQrDailyLimit) };
      const res: any = await api(`/system/wallet-support`, { method: 'POST', body: JSON.stringify(body) });
      if (res?.data?.apps) setWalletApps(res.data.apps);
      if (res?.data?.qr) setWalletQrDailyLimit(String(res.data.qr.dailyLimit ?? ""));
      toast.success('Wallet support saved');
    } catch {
      toast.error('Failed to save wallet support');
    } finally {
      setSavingWallet(false);
    }
  }

  async function saveCaptchaSettings() {
    setSavingCaptcha(true);
    try {
      const body: any = {
        miniappEnabled: !!captchaMiniappEnabled,
        svgEnabled: !!captchaSvgEnabled,
        requireAtLeastOne: !!captchaRequireAtLeastOne,
        forExistingUsers: !!captchaForExistingUsers,
      };
      if (captchaSessionTimeout !== "") body.sessionTimeout = Number(captchaSessionTimeout);
      if (captchaMaxAttempts !== "") body.maxAttempts = Number(captchaMaxAttempts);
      const res: any = await api(`/system/captcha-settings`, { method: 'POST', body: JSON.stringify(body) });
      const cp = res?.data;
      if (cp) {
        setCaptchaMiniappEnabled(!!cp.miniappEnabled);
        setCaptchaSvgEnabled(!!cp.svgEnabled);
        setCaptchaRequireAtLeastOne(!!cp.requireAtLeastOne);
        setCaptchaForExistingUsers(!!cp.forExistingUsers);
        setCaptchaSessionTimeout(String(cp.sessionTimeout ?? ""));
        setCaptchaMaxAttempts(String(cp.maxAttempts ?? ""));
      }
      toast.success('CAPTCHA settings saved');
    } catch {
      toast.error('Failed to save CAPTCHA settings');
    } finally {
      setSavingCaptcha(false);
    }
  }

  async function saveBlockchainSettings() {
    setSavingBlockchain(true);
    try {
      const body: any = {};
      if (bcChainId !== "") body.chainId = Number(bcChainId);
      if (bcRpcUrl !== "") body.rpcUrl = bcRpcUrl;
      if (bcExplorerUrl !== "") body.explorerUrl = bcExplorerUrl;
      if (bcConfirmations !== "") body.confirmationsToWait = Number(bcConfirmations);
      if (bcTokenContract !== "") body.tokenContractAddress = bcTokenContract;
      if (bcClaimContract !== "") body.claimContractAddress = bcClaimContract;
      if (bcTokenSymbol !== "") body.tokenSymbol = bcTokenSymbol;
      if (bcTokenDecimals !== "") body.tokenDecimals = Number(bcTokenDecimals);
      const res: any = await api(`/system/wallet-config`, { method: 'POST', body: JSON.stringify(body) });
      const wc = res?.data;
      if (wc) {
        const n = wc.network || {};
        const c = wc.contracts || {};
        const t = wc.token || {};
        setBcChainId(String(n.chainId ?? ""));
        setBcRpcUrl(String(n.rpcUrl ?? ""));
        setBcExplorerUrl(String(n.explorerUrl ?? ""));
        setBcConfirmations(String(n.confirmationsToWait ?? ""));
        setBcTokenContract(String(c.tokenContractAddress ?? ""));
        setBcClaimContract(String(c.claimContractAddress ?? ""));
        setBcTokenSymbol(String(t.tokenSymbol ?? ""));
        setBcTokenDecimals(String(t.tokenDecimals ?? ""));
      }
      toast.success('Blockchain settings saved');
    } catch {
      toast.error('Failed to save blockchain settings');
    } finally {
      setSavingBlockchain(false);
    }
  }

  function setUrl(id: string, v: string) {
    setUrlMap((m) => ({ ...m, [id]: v }));
    setChangedUrls((s) => new Set(s).add(id));
  }
  function setPoints(id: string, v: string) {
    const n = Number(v);
    setPointsMap((m) => ({ ...m, [id]: isNaN(n) ? 0 : n }));
    setChangedPoints((s) => new Set(s).add(id));
  }
  function setTaskAutoApprove(id: string, v: boolean) {
    setAutoApproveMap((m) => ({ ...m, [id]: v }));
    setChangedAutoApprove((s) => new Set(s).add(id));
  }

  const urlChanges = useMemo(() => Array.from(changedUrls).filter(id => {
    const t = tasks.find(tt => tt.id === id);
    if (!t) return false;
    const btnUrl = Array.isArray(t.buttons)
      ? (t.buttons.find((b: any) => b?.action === 'open_url' && b?.url)?.url || '')
      : '';
    const current = t?.metadata?.targetUrl || btnUrl || '';
    return (urlMap[id] ?? '') !== current;
  }), [changedUrls, tasks, urlMap]);
  const pointChanges = useMemo(() => Array.from(changedPoints).filter(id => tasks.find(t => t.id === id && (pointsMap[id] ?? 0) !== (t?.points ?? 0))), [changedPoints, tasks, pointsMap]);
  const autoApproveChanges = useMemo(() => Array.from(changedAutoApprove).filter(id => {
    const t = tasks.find(tt => tt.id === id);
    if (!t || !t.validation?.submissionRequired) return false;
    return (autoApproveMap[id] ?? false) !== (t?.validation?.autoApprove ?? false);
  }), [changedAutoApprove, tasks, autoApproveMap]);

  async function saveUrls() {
    if (!canManageTasks || urlChanges.length === 0) return;
    setSavingUrls(true);
    const ops = urlChanges.map(async (id) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      const updatedButtons = Array.isArray(t.buttons)
        ? t.buttons.map((b: any) => {
            if (b?.action === 'open_url' && (!b?.callback || b?.url)) {
              return { ...b, url: urlMap[id] };
            }
            return b;
          })
        : t.buttons;
      const body = { ...t, metadata: { ...(t.metadata || {}), targetUrl: urlMap[id] }, buttons: updatedButtons };
      try {
        await api(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(body) });
      } catch (e: any) {
        throw e;
      }
    });
    try {
      await Promise.all(ops);
      toast.success("URLs saved");
      await load();
    } catch {
      toast.error("Failed to save URLs");
    } finally {
      setSavingUrls(false);
    }
  }

  async function savePoints() {
    if (!canManageTasks || pointChanges.length === 0) return;
    setSavingPoints(true);
    const ops = pointChanges.map(async (id) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      const body = { ...t, points: pointsMap[id] };
      try {
        await api(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(body) });
      } catch (e: any) {
        throw e;
      }
    });
    try {
      await Promise.all(ops);
      toast.success("Rewards saved");
      await load();
    } catch {
      toast.error("Failed to save rewards");
    } finally {
      setSavingPoints(false);
    }
  }

  async function saveAutoApproveSettings() {
    if (!canManageTasks || autoApproveChanges.length === 0) return;
    setSavingAutoApprove(true);
    const ops = autoApproveChanges.map(async (id) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      const updatedValidation = { ...(t.validation || {}), autoApprove: autoApproveMap[id], reviewRequired: !autoApproveMap[id] };
      const body = { ...t, validation: updatedValidation };
      try {
        await api(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(body) });
      } catch (e: any) {
        throw e;
      }
    });
    try {
      await Promise.all(ops);
      toast.success("Auto-approve settings saved");
      await load();
    } catch {
      toast.error("Failed to save auto-approve settings");
    } finally {
      setSavingAutoApprove(false);
    }
  }

  async function exportUsersCsv() {
    setExportingUsers(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
      const res = await fetch(`${apiBase}/users/export`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error('Export failed');
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'users.csv'; a.click(); URL.revokeObjectURL(url);
      toast.success('Users CSV exported');
    } catch {
      toast.error('Failed to export users CSV');
    } finally {
      setExportingUsers(false);
    }
  }

  async function exportCollection() {
    setExporting(true);
    try {
      const qs = new URLSearchParams();
      qs.set('collection', expCollection || 'users');
      qs.set('format', expFormat);
      if (expFilter) qs.set('filter', expFilter);
      if (expProjection) qs.set('projection', expProjection);
      if (expSort) qs.set('sort', expSort);
      if (expLimit) qs.set('limit', expLimit);
      const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
      const res = await fetch(`${apiBase}/db/export?${qs.toString()}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error('Export failed');
      const ct = res.headers.get('content-type') || '';
      const disposition = res.headers.get('content-disposition') || '';
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch ? filenameMatch[1] : `${expCollection}.${expFormat}`;
      const data = expFormat === 'csv' ? await res.text() : await res.text();
      const blob = new Blob([data], { type: ct || (expFormat === 'csv' ? 'text/csv' : 'application/json') });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
      toast.success('Export completed');
    } catch {
      toast.error('Failed to export');
    } finally {
      setExporting(false);
    }
  }

  async function saveAutoExportSettings() {
    setSavingUde(true);
    try {
      const res: any = await api(`/system/user-data-export`, { method: 'POST', body: JSON.stringify({ enabled: !!udeEnabled, interval: udeInterval, runOnStart: !!udeRunOnStart }) });
      const d = res?.data;
      if (d?.settings) {
        setUdeEnabled(!!d.settings.enabled);
        setUdeInterval(String(d.settings.interval || '1h'));
        setUdeRunOnStart(!!d.settings.runOnStart);
      }
      if (d?.status) {
        setUdeRunning(!!d.status.running);
        setUdeLastExport(String(d.status.lastExport || ''));
        setUdeNextRun(String(d.status.nextRun || ''));
      }
      toast.success('Auto export settings saved');
    } catch {
      toast.error('Failed to save auto export');
    } finally {
      setSavingUde(false);
    }
  }

  async function forceAutoExport() {
    setForcingUde(true);
    try {
      const res: any = await api(`/system/user-data-export/force`, { method: 'POST' });
      if (res?.success) toast.success('Export started'); else toast.error(res?.message || 'Failed to start export');
    } catch {
      toast.error('Failed to start export');
    } finally {
      setForcingUde(false);
    }
  }

  async function saveReferralSettings() {
    setSavingReferral(true);
    try {
      const body: any = {};
      if (referralBonus !== "") body.referralBonus = Number(referralBonus);
      if (referralWelcomeBonus !== "") body.referralWelcomeBonus = Number(referralWelcomeBonus);
      body.referralWelcomeBonusEnabled = !!referralWelcomeBonusEnabled;
      if (referralCodeLength !== "") body.codeLength = Number(referralCodeLength);
      if (referralTaskThreshold !== "") body.taskThreshold = Number(referralTaskThreshold);
      const res: any = await api(`/system/referral-settings`, { method: 'POST', body: JSON.stringify(body) });
      const d = res?.data;
      if (d) {
        setReferralBonus(String(d.referralBonus ?? ""));
        setReferralWelcomeBonus(String(d.referralWelcomeBonus ?? ""));
        setReferralWelcomeBonusEnabled(!!d.referralWelcomeBonusEnabled);
        setReferralCodeLength(String(d.codeLength ?? ""));
        setReferralTaskThreshold(String(d.taskThreshold ?? ""));
      }
      toast.success('Referral settings saved');
    } catch (e) {
      toast.error('Failed to save referral settings');
    } finally {
      setSavingReferral(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Control</h1>
          <p className="text-muted-foreground mt-1">Manage task URLs and rewards</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>Reload</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <Card className="rounded-2xl border bg-card/95 h-full min-h-[300px]">
          <CardHeader>
            <CardTitle className="text-lg">Task Links</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col h-full">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : (
              <>
                <div className="flex-1 overflow-auto pr-2 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {tasks.filter(taskHasUrl).map((t) => (
                      <div key={`url-${t.id}`} className="space-y-1">
                        <Label className="text-sm text-foreground/90">{stripEmojis(t.title)}</Label>
                        <Input
                          placeholder="https://..."
                          value={urlMap[t.id] ?? ""}
                          onChange={(e) => setUrl(t.id, e.target.value)}
                          disabled={!canManageTasks}
                          className="h-10 rounded-xl"
                        />
                      </div>
                    ))}
                  </div>
                  {tasks.filter(taskHasUrl).length === 0 && (
                    <div className="text-sm text-muted-foreground">No URL-based tasks available</div>
                  )}
                </div>
                <div className="pt-2 flex justify-start mt-auto">
                  <Button onClick={saveUrls} disabled={!canManageTasks || savingUrls || urlChanges.length === 0} className="rounded-full px-5">
                    {savingUrls ? "Saving..." : "Save URLs"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border bg-card/95 h-full min-h-[300px]">
          <CardHeader>
            <CardTitle className="text-lg">Task Auto-Approve Settings</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col h-full">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : (
              <>
                <div className="flex-1 overflow-auto pr-2 space-y-4">
                  <div className="grid grid-cols-1 gap-3">
                    {tasks.filter((t) => t?.validation?.submissionRequired).map((t) => (
                      <div key={`auto-${t.id}`} className="flex items-center gap-3 p-3 rounded-lg border">
                        <Checkbox
                          id={`task-auto-${t.id}`}
                          checked={!!autoApproveMap[t.id]}
                          onCheckedChange={(v: any) => setTaskAutoApprove(t.id, !!v)}
                          disabled={!canManageTasks}
                        />
                        <Label htmlFor={`task-auto-${t.id}`} className="text-sm text-foreground/90 cursor-pointer flex-1">
                          {stripEmojis(t.title)}
                        </Label>
                      </div>
                    ))}
                  </div>
                  {tasks.filter((t) => t?.validation?.submissionRequired).length === 0 && (
                    <div className="text-sm text-muted-foreground">No submission-based tasks available</div>
                  )}
                </div>
                <div className="pt-2 flex justify-start mt-auto">
                  <Button
                    onClick={saveAutoApproveSettings}
                    disabled={!canManageTasks || savingAutoApprove || autoApproveChanges.length === 0}
                    className="rounded-full px-5"
                  >
                    {savingAutoApprove ? "Saving..." : "Save Auto-Approve Settings"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <Card className="rounded-2xl border bg-card/95 h-full min-h-[300px]">
          <CardHeader>
            <CardTitle className="text-lg">Tasks Rewards</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col h-full">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : (
              <>
                <div className="flex-1 overflow-auto pr-2 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {tasks.map((t) => (
                      <div key={`pts-${t.id}`} className="space-y-1">
                        <Label className="text-sm text-foreground/90">{stripEmojis(t.title)}</Label>
                        <Input
                          type="number"
                          placeholder="Points"
                          value={String(pointsMap[t.id] ?? 0)}
                          onChange={(e) => setPoints(t.id, e.target.value)}
                          disabled={!canManageTasks}
                          className="h-10 rounded-xl"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="pt-2 flex justify-start mt-auto">
                  <Button onClick={savePoints} disabled={!canManageTasks || savingPoints || pointChanges.length === 0} className="rounded-full px-5">
                    {savingPoints ? "Saving..." : "Save Rewards"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border bg-card/95 h-full min-h-[300px]">
          <CardHeader>
            <CardTitle className="text-lg">Bot Status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Bot Online</Label>
                <div className="flex items-center gap-3">
                  <Checkbox id="bot-online" checked={!!botOnline} onCheckedChange={(v:any)=>setBotOnline(!!v)} />
                  <Label htmlFor="bot-online" className="text-sm text-muted-foreground">Enable bot responses</Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Maintenance Mode</Label>
                <div className="flex items-center gap-3">
                  <Checkbox id="maint-mode" checked={!!maintenanceMode} onCheckedChange={(v:any)=>setMaintenanceMode(!!v)} />
                  <Label htmlFor="maint-mode" className="text-sm text-muted-foreground">Temporarily block users</Label>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Maintenance Duration</Label>
                <Input value={maintDuration} onChange={(e)=>setMaintDuration(e.target.value)} placeholder="e.g. 30m or 2h" className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>Reason</Label>
                <Input value={maintReason} onChange={(e)=>setMaintReason(e.target.value)} placeholder="Short reason" className="h-10 rounded-xl" />
              </div>
            </div>
            <div className="pt-3 flex justify-start mt-auto">
              <Button onClick={saveBotStatus} disabled={savingStatus} className="rounded-full px-5">{savingStatus? 'Saving...' : 'Save Bot Status'}</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border bg-card/95 h-full min-h-[300px]">
          <CardHeader>
            <CardTitle className="text-lg">Withdrawal Settings</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Minimum Points to Withdraw</Label>
                <Input type="number" value={minWithdraw} onChange={(e)=>setMinWithdraw(e.target.value)} placeholder="e.g. 100" className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>Conversion Rate (points → token)</Label>
                <Input type="number" step="0.000001" value={conversionRate} onChange={(e)=>setConversionRate(e.target.value)} placeholder="e.g. 0.001" className="h-10 rounded-xl" />
              </div>
            </div>
            <div className="pt-4 space-y-3">
              <div className="space-y-1">
                <Label>Alert Channel ID (for withdrawal & transfer alerts)</Label>
                <Input type="text" value={withdrawAlertChannel} onChange={(e)=>setWithdrawAlertChannel(e.target.value)} placeholder="@channel or -100123456789" className="h-10 rounded-xl" />
                <p className="text-xs text-muted-foreground">Bot must be admin in this channel</p>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="requireChannelJoin" checked={requireChannelJoin} onCheckedChange={(checked) => setRequireChannelJoin(!!checked)} />
                <Label htmlFor="requireChannelJoin" className="text-sm font-normal cursor-pointer">
                  Require telegram channel join for withdrawal
                </Label>
              </div>
              {requireChannelJoin && (
                <div className="space-y-1 pl-6">
                  <Label>Required Channel ID (users must join)</Label>
                  <Input type="text" value={requiredChannelId} onChange={(e)=>setRequiredChannelId(e.target.value)} placeholder="@yourchannel or -100123456789" className="h-10 rounded-xl" />
                  <p className="text-xs text-muted-foreground">Channel users must join before withdrawal</p>
                </div>
              )}
            </div>
            <div className="pt-3 flex justify-start mt-auto">
              <Button onClick={saveWithdrawSettings} disabled={savingWithdraw} className="rounded-full px-5">{savingWithdraw? 'Saving...' : 'Save Withdrawal Settings'}</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <Card className="rounded-2xl border bg-card/95 h-full min-h-[300px]">
          <CardHeader>
            <CardTitle className="text-lg">Transfer System</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Enabled</Label>
                <div className="flex items-center gap-3">
                  <Checkbox id="transfer-enabled" checked={!!transferEnabled} onCheckedChange={(v:any)=>setTransferEnabled(!!v)} />
                  <Label htmlFor="transfer-enabled" className="text-sm text-muted-foreground">Allow user-to-user transfers</Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Require Confirmation</Label>
                <div className="flex items-center gap-3">
                  <Checkbox id="transfer-confirm" checked={!!transferRequireConfirm} onCheckedChange={(v:any)=>setTransferRequireConfirm(!!v)} />
                  <Label htmlFor="transfer-confirm" className="text-sm text-muted-foreground">Ask user to confirm before sending</Label>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Minimum Amount</Label>
                <Input type="number" value={transferMin} onChange={(e)=>setTransferMin(e.target.value)} placeholder="e.g. 50" className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>Maximum Amount</Label>
                <Input type="number" value={transferMax} onChange={(e)=>setTransferMax(e.target.value)} placeholder="e.g. 10000" className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>Max Daily Amount</Label>
                <Input type="number" value={transferDailyMax} onChange={(e)=>setTransferDailyMax(e.target.value)} placeholder="e.g. 1000" className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>Daily Transfer Count Limit</Label>
                <Input type="number" value={transferDailyLimit} onChange={(e)=>setTransferDailyLimit(e.target.value)} placeholder="e.g. 1" className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>Fee Percentage (%)</Label>
                <Input type="number" step="0.01" value={transferFee} onChange={(e)=>setTransferFee(e.target.value)} placeholder="e.g. 2" className="h-10 rounded-xl" />
              </div>
            </div>
            <div className="pt-3 flex justify-start mt-auto">
              <Button onClick={saveTransferSettings} disabled={savingTransfer} className="rounded-full px-5">{savingTransfer? 'Saving...' : 'Save Transfer Settings'}</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border bg-card/95 h-full min-h-[300px]">
          <CardHeader>
            <CardTitle className="text-lg">Wallet Support</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { key: 'metamask', label: 'MetaMask' },
                { key: 'trust', label: 'Trust Wallet' },
                { key: 'coinbase', label: 'Coinbase' },
                { key: 'rainbow', label: 'Rainbow' },
                { key: 'bitget', label: 'Bitget' },
                { key: 'phantom', label: 'Phantom' },
                { key: 'exodus', label: 'Exodus' },
                { key: 'atomic', label: 'Atomic' },
                { key: 'safepal', label: 'SafePal' },
                { key: 'tokenpocket', label: 'TokenPocket' },
              ].map(({ key, label }) => (
                <div key={key} className="space-y-2">
                  <Label>{label}</Label>
                  <div className="flex items-center gap-3">
                    <Checkbox id={`wallet-${key}`} checked={!!walletApps[key]} onCheckedChange={(v:any)=>setWalletApps((m)=>({ ...m, [key]: !!v }))} />
                    <Label htmlFor={`wallet-${key}`} className="text-sm text-muted-foreground">Show in connect options</Label>
                  </div>
                </div>
              ))}
              <div className="space-y-1 md:col-span-2">
                <Label>Daily QR Limit</Label>
                <Input type="number" value={walletQrDailyLimit} onChange={(e)=>setWalletQrDailyLimit(e.target.value)} placeholder="10" className="h-10 rounded-xl" />
              </div>
            </div>
            <div className="pt-3 flex justify-start mt-auto">
              <Button onClick={saveWalletSupport} disabled={savingWallet} className="rounded-full px-5">{savingWallet? 'Saving...' : 'Save Wallet Support'}</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <Card className="rounded-2xl border bg-card/95 h-full min-h-[300px]">
          <CardHeader>
            <CardTitle className="text-lg">CAPTCHA System</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Miniapp CAPTCHA</Label>
                <div className="flex items-center gap-3">
                  <Checkbox id="captcha-miniapp" checked={!!captchaMiniappEnabled} onCheckedChange={(v:any)=>setCaptchaMiniappEnabled(!!v)} />
                  <Label htmlFor="captcha-miniapp" className="text-sm text-muted-foreground">Enable miniapp challenges</Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label>SVG CAPTCHA</Label>
                <div className="flex items-center gap-3">
                  <Checkbox id="captcha-svg" checked={!!captchaSvgEnabled} onCheckedChange={(v:any)=>setCaptchaSvgEnabled(!!v)} />
                  <Label htmlFor="captcha-svg" className="text-sm text-muted-foreground">Enable SVG challenges</Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Require At Least One</Label>
                <div className="flex items-center gap-3">
                  <Checkbox id="captcha-require-one" checked={!!captchaRequireAtLeastOne} onCheckedChange={(v:any)=>setCaptchaRequireAtLeastOne(!!v)} />
                  <Label htmlFor="captcha-require-one" className="text-sm text-muted-foreground">Require any one method</Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Apply To Existing Users</Label>
                <div className="flex items-center gap-3">
                  <Checkbox id="captcha-existing" checked={!!captchaForExistingUsers} onCheckedChange={(v:any)=>setCaptchaForExistingUsers(!!v)} />
                  <Label htmlFor="captcha-existing" className="text-sm text-muted-foreground">Ask existing users too</Label>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Session Timeout (ms)</Label>
                <Input type="number" value={captchaSessionTimeout} onChange={(e)=>setCaptchaSessionTimeout(e.target.value)} placeholder="e.g. 300000" className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>Max Attempts</Label>
                <Input type="number" value={captchaMaxAttempts} onChange={(e)=>setCaptchaMaxAttempts(e.target.value)} placeholder="e.g. 3" className="h-10 rounded-xl" />
              </div>
            </div>
            <div className="pt-3 flex justify-start mt-auto">
              <Button onClick={saveCaptchaSettings} disabled={savingCaptcha} className="rounded-full px-5">{savingCaptcha? 'Saving...' : 'Save CAPTCHA Settings'}</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border bg-card/95 h-full min-h-[300px]">
          <CardHeader>
            <CardTitle className="text-lg">Blockchain</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Chain ID</Label>
                <Input type="number" value={bcChainId} onChange={(e)=>setBcChainId(e.target.value)} placeholder="e.g. 1" className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>RPC URL</Label>
                <Input value={bcRpcUrl} onChange={(e)=>setBcRpcUrl(e.target.value)} placeholder="https://..." className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>Explorer URL</Label>
                <Input value={bcExplorerUrl} onChange={(e)=>setBcExplorerUrl(e.target.value)} placeholder="https://..." className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>Confirmations To Wait</Label>
                <Input type="number" value={bcConfirmations} onChange={(e)=>setBcConfirmations(e.target.value)} placeholder="e.g. 1" className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>Token Contract</Label>
                <Input value={bcTokenContract} onChange={(e)=>setBcTokenContract(e.target.value)} placeholder="0x..." className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>Claim Contract</Label>
                <Input value={bcClaimContract} onChange={(e)=>setBcClaimContract(e.target.value)} placeholder="0x..." className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>Token Symbol</Label>
                <Input value={bcTokenSymbol} onChange={(e)=>setBcTokenSymbol(e.target.value)} placeholder="TOKEN" className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>Token Decimals</Label>
                <Input type="number" value={bcTokenDecimals} onChange={(e)=>setBcTokenDecimals(e.target.value)} placeholder="18" className="h-10 rounded-xl" />
              </div>
            </div>
            <div className="pt-3 flex justify-start mt-auto">
              <Button onClick={saveBlockchainSettings} disabled={savingBlockchain} className="rounded-full px-5">{savingBlockchain? 'Saving...' : 'Save Blockchain Settings'}</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <Card className="rounded-2xl border bg-card/95 h-full min-h-[300px]">
          <CardHeader>
            <CardTitle className="text-lg">Auto User Data Export</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col h-full">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-base font-medium">Auto User Data Export</div>
                <div className="text-xs text-muted-foreground">{udeRunning ? `Running • Next: ${udeNextRun || 'N/A'}` : 'Stopped'}</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Enable</Label>
                  <div className="flex items-center gap-3">
                    <Checkbox id="ude-enabled" checked={!!udeEnabled} onCheckedChange={(v:any)=>setUdeEnabled(!!v)} />
                    <Label htmlFor="ude-enabled" className="text-sm text-muted-foreground">Send CSV to admin automatically</Label>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Interval</Label>
                  <Input value={udeInterval} onChange={(e)=>setUdeInterval(e.target.value)} placeholder="5m | 1h | 14:30" className="h-10 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <Label>Run on Start</Label>
                  <div className="flex items-center gap-3">
                    <Checkbox id="ude-run" checked={!!udeRunOnStart} onCheckedChange={(v:any)=>setUdeRunOnStart(!!v)} />
                    <Label htmlFor="ude-run" className="text-sm text-muted-foreground">Trigger on server start</Label>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Last Export</Label>
                  <Input readOnly value={udeLastExport || ''} placeholder="-" className="h-10 rounded-xl" />
                </div>
              </div>
              <div className="pt-2 flex gap-2">
                <Button variant="secondary" onClick={saveAutoExportSettings} disabled={savingUde}>{savingUde ? 'Saving...' : 'Save Settings'}</Button>
                <Button onClick={forceAutoExport} disabled={forcingUde} className="rounded-full px-5">{forcingUde ? 'Running...' : 'Force Export Now'}</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border bg-card/95 h-full min-h-[300px]">
          <CardHeader>
            <CardTitle className="text-lg">Referral System Configuration</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Referral Bonus</Label>
                <Input type="number" value={referralBonus} onChange={(e)=>setReferralBonus(e.target.value)} placeholder="15" className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>Welcome Bonus</Label>
                <Input type="number" value={referralWelcomeBonus} onChange={(e)=>setReferralWelcomeBonus(e.target.value)} placeholder="7" className="h-10 rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label>Welcome Bonus Enabled</Label>
                <div className="flex items-center gap-3">
                  <Checkbox id="welcome-enabled" checked={!!referralWelcomeBonusEnabled} onCheckedChange={(v:any)=>setReferralWelcomeBonusEnabled(!!v)} />
                  <Label htmlFor="welcome-enabled" className="text-sm text-muted-foreground">Enable/disable welcome bonus for referred users</Label>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Referral Code Length</Label>
                <Input type="number" value={referralCodeLength} onChange={(e)=>setReferralCodeLength(e.target.value)} placeholder="8" className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label>Task Threshold</Label>
                <Input type="number" value={referralTaskThreshold} onChange={(e)=>setReferralTaskThreshold(e.target.value)} placeholder="3" className="h-10 rounded-xl" />
              </div>
            </div>
            <div className="pt-3 flex justify-start mt-auto">
              <Button onClick={saveReferralSettings} disabled={savingReferral} className="rounded-full px-5">{savingReferral? 'Saving...' : 'Save Referral Settings'}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}