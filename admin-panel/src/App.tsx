import { useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DocumentViewer } from "@/components/DocumentViewer";
import { TableLoadingSkeleton } from "@/components/LoadingSkeleton";
import DatabaseSimpleView from "@/components/DatabaseSimpleView";
import LogViewer from "@/components/LogViewer";
import AdminControlView from "./components/AdminControlView";
import BotMonitor from "@/pages/BotMonitor";
import {
  BarChart3,
  Blocks,
  Bot,
  Share2,
  CheckCheck,
  ChevronRight,
  ChevronLeft,
  Download,
  LineChart,
  LogOut,
  Megaphone,
  Search,
  Settings,
  Shield,
  Sparkles,
  Users,
  Wallet,
  Database,
  RefreshCw,
  Layers,
  FileJson,
  Code,
  Table as TableIcon,
  Filter,
  Play,
  FileText,
  Calendar,
  List,
  Braces,
  MoreVertical,
  MessageCircle,
  Coins,
  TrendingUp,
  Target,
  PieChart,
  Activity,
  UserCheck,
  ArrowUpRight,
  Clock3,
} from "lucide-react";

const apiBase =
  (import.meta.env.VITE_API_BASE as string) ||
  (typeof window !== "undefined" ? `${window.location.origin}/api/admin` : "/api/admin");

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-cache" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${apiBase}${path}`, { cache: 'no-store',
    headers,
    credentials: "include",
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/csv")) {
    // @ts-ignore
    return res.text();
  }
  return res.json() as Promise<T>;
}

type View = "request" | "login" | "app";
type Section =
  | "dashboard"
  | "users"
  | "tasks"
  | "submissions"
  | "blocked_users"
  | "security"
  | "support"
  | "broadcasts"
  | "claims"
  | "referrals"
  | "wallet"
  | "database"
  | "settings"
  | "admin_control"
  | "logs"
  | "bot_monitor";

type UsersQuery = { q?: string; verified?: string; blocked?: string; hasWallet?: string; page: number; pageSize: number };

export default function AdminApp() {
  const [view, setView] = useState<View>("request");
  const [section, setSection] = useState<Section>("dashboard");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [me, setMe] = useState<any | null>(null);
  const [connected, setConnected] = useState(true);
  const [usersQuery, setUsersQuery] = useState<UsersQuery>({ q: "", page: 1, pageSize: 20 });

  const role: string = (me?.user?.role || me?.role || "viewer") as string;
  const canManageUsers = role === "admin" || role === "super_admin";
  const canManageTasks = role === "admin" || role === "super_admin";
  const canModerate = role === "moderator" || role === "admin" || role === "super_admin";
  const canExport = canManageUsers;
  const canSendBroadcast = role === "admin" || role === "super_admin";
  const canViewClaimAnalytics = role === "admin" || role === "super_admin";
  const canViewAdminSettings = role === "admin" || role === "super_admin";
  const isSuperAdmin = role === "super_admin";

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;
    if (token) setView("app");
  }, []);

  useEffect(() => {
    if (view === "app") void refresh();
  }, [view]);

  const idleLogoutMs = Number((import.meta as any).env?.VITE_ADMIN_IDLE_LOGOUT_MS || 600000);

  const getTokenExpMs = () => {
    try {
      const t = typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;
      if (!t) return null;
      const p = t.split(".")[1];
      if (!p) return null;
      const json = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
      return typeof json.exp === "number" ? json.exp * 1000 : null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (view !== "app") return;
    let last = Date.now();
    const reset = () => { last = Date.now(); };
    const evts = ["mousemove","keydown","click","scroll","touchstart"]; 
    evts.forEach((e) => window.addEventListener(e, reset));
    const interval = setInterval(() => {
      if (Date.now() - last >= idleLogoutMs) {
        logout();
      }
    }, 30000);
    return () => { evts.forEach((e) => window.removeEventListener(e, reset)); clearInterval(interval); };
  }, [view]);

  useEffect(() => {
    if (view !== "app") return;
    const expMs = getTokenExpMs();
    let timer: any = null;
    if (expMs) {
      const delay = Math.max(0, expMs - Date.now());
      timer = setTimeout(() => { logout(); }, delay);
    }
    const poll = setInterval(() => { void refresh(); }, 60000);
    return () => { if (timer) clearTimeout(timer); clearInterval(poll); };
  }, [view]);
  useEffect(() => {
    try {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(()=>{});
      }
    } catch {}
  }, []);

  async function refresh() {
    try {
      const [meRes, overview] = await Promise.allSettled([
        api<any>("/auth/me"),
        api<any>("/analytics/overview"),
      ]);
      const meOk = meRes.status === "fulfilled";
      if (meOk) setMe((meRes as any).value);
      if (overview.status === "fulfilled") setStats((overview as any).value.data);
      setConnected(meOk);
    } catch {
      setConnected(false);
      toast.error("Failed to load analytics");
    }
  }

  async function requestLogin() {
    setLoading(true);
    try {
      const res = await api<{ success: boolean; requestId: string }>("/login/request", { method: "POST", body: JSON.stringify({}) });
      if (res && (res as any).success) {
        toast.success("One-time credentials sent to Telegram admin");
        setRequestSent(true);
        setView("login");
      } else {
        toast.error("Request failed");
      }
    } catch {
      toast.error("Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function login() {
    if (!username || !password) { toast.error("Enter username and password"); return; }
    if (!requestSent) { toast.error("Please click Request Login first"); return; }
    setLoading(true);
    try {
      const res = await api<{ success: boolean; token: string }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      if ((res as any).success && (res as any).token) {
        localStorage.setItem("admin_token", (res as any).token);
        toast.success("Logged in successfully");
        setView("app");
        setRequestSent(false);
        void refresh();
      } else {
        toast.error("Invalid credentials");
      }
    } catch {
      toast.error("Login failed");
    } finally { setLoading(false); }
  }

  async function logout() {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    localStorage.removeItem("admin_token");
    setUsername(""); setPassword(""); setView("request"); setRequestSent(false);
  }

  const cards = useMemo(() => {
    const u = stats?.users || {}; const t = stats?.tasks || {}; const sys = stats?.system || {};
    return [
      { title: "Total Users", value: u.total ?? 0, icon: Users, color: "text-blue-600" },
      { title: "Active Users", value: u.active ?? 0, icon: Users, color: "text-green-600" },
      { title: "Verified Users", value: u.verified ?? 0, icon: Shield, color: "text-purple-600" },
      { title: "Users with Wallet", value: u.withWallet ?? 0, icon: Wallet, color: "text-orange-600" },
      { title: "Blocked Users", value: u.blocked ?? 0, icon: Shield, color: "text-red-600" },
      { title: "Total Tasks", value: t.total ?? 0, icon: BarChart3, color: "text-indigo-600" },
      { title: "Active Tasks", value: t.active ?? 0, icon: BarChart3, color: "text-teal-600" },
      { title: "Task Completions", value: t.completed ?? 0, icon: LineChart, color: "text-cyan-600" },
      { title: "Pending Submissions", value: t.pending ?? 0, icon: Blocks, color: "text-yellow-600" },
      { title: "System Uptime (h)", value: Math.floor((sys.uptime || 0) / 3600), icon: Sparkles, color: "text-pink-600" },
    ];
  }, [stats]);

  if (view === "request") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0b2a6c] via-[#0b2a6c] to-[#1a4b9c] flex items-center justify-center p-6">
        <Toaster />
        <Card className="relative w-full max-w-md border-border/60 bg-background/90 shadow-2xl">
          <CardHeader className="items-center gap-2 text-center">
            <div className="h-12 w-12 rounded-full bg-primary/10 text-primary grid place-items-center mb-2">
              <Shield className="h-6 w-6" />
            </div>
            <CardTitle className="text-2xl">Admin Portal</CardTitle>
            <p className="text-sm text-muted-foreground">Secure access with Request Login</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button className="w-full" size="lg" onClick={requestLogin} disabled={loading}>
              {loading ? "Sending..." : "Request Login"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Click to generate one-time credentials. They will be sent to the Telegram admin and expire shortly.
            </p>
            <Separator className="my-2" />
            <p className="text-[11px] text-muted-foreground text-center">One-time credentials. Logout requires a new request.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (view === "login") {
    return (
      <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background flex items-center justify-center p-6">
        <Toaster />
        <Card className="relative w-full max-w-md backdrop-blur border-border/60 bg-background/70">
          <CardHeader>
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Sparkles size={12} />
              <span>Vibe Admin Panel</span>
            </div>
            <CardTitle className="text-2xl">Sign in</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username (from Telegram)</Label>
              <Input id="username" placeholder="Enter username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password (from Telegram)</Label>
              <Input id="password" type="password" placeholder="Enter password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setView("request")}>Back</Button>
              <Button onClick={login} disabled={loading || !requestSent}>Login</Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">Use the username and password sent to Telegram to sign in.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <Toaster />
        <Sidebar collapsible="icon" className="border-r border-border">
          <SidebarHeader className="px-4 py-4 border-b bg-gradient-to-r from-primary/5 to-transparent">
            <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shadow-lg shadow-primary/20">
                  <Sparkles className="h-5 w-5 text-primary animate-pulse" />
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-sm">Vibe Admin</span>
                <span className="text-xs text-muted-foreground">Control Panel</span>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Overview</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={section === "dashboard"} onClick={() => setSection("dashboard")} className="relative overflow-hidden group transition-all duration-200 hover:bg-primary/5">
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500" />
                      <BarChart3 className="h-4 w-4 text-primary" /> <span className="font-medium">Dashboard</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Manage</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={section === "users"} onClick={() => setSection("users")}>
                      <Users /> <span>Users</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={section === "tasks"} onClick={() => setSection("tasks")}>
                      <CheckCheck /> <span>Tasks</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={section === "submissions"} onClick={() => setSection("submissions")}>
                      <Blocks /> <span>Submissions</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={section === "blocked_users"} onClick={() => setSection("blocked_users")}>
                      <Shield /> <span>Blocked Users</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={section === "security"} onClick={() => setSection("security")}>
                      <Shield /> <span>Security Audit</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={section === "support"} onClick={() => setSection("support")}>
                      <MessageCircle className="h-4 w-4" /> <span>Support</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Comms & Economy</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={section === "broadcasts"} onClick={() => setSection("broadcasts")}>
                      <Megaphone /> <span>Broadcasts</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {canViewClaimAnalytics && (
                    <SidebarMenuItem>
                      <SidebarMenuButton isActive={section === "claims"} onClick={() => setSection("claims")}>
                        <Coins /> <span>Claim Analytics</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={section === "referrals"} onClick={() => setSection("referrals")}>
                      <Share2 /> <span>Referrals</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={section === "wallet"} onClick={() => setSection("wallet")}>
                      <Wallet /> <span>Wallet</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>System</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={section === "database"} onClick={() => setSection("database")}>
                      <Database /> <span>Database</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton isActive={section === "logs"} onClick={() => setSection("logs")}>
                        <FileText /> <span>Logs</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton isActive={section === "bot_monitor"} onClick={() => setSection("bot_monitor")}>
                        <Activity /> <span>Bot Monitor</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={section === "admin_control"} onClick={() => setSection("admin_control")}>
                      <Settings /> <span>Admin Control</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={section === "settings"} onClick={() => setSection("settings")}>
                      <Settings /> <span>Admin Settings</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="flex-1 flex flex-col overflow-hidden">
          <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-16 items-center gap-4 px-4 md:px-6">
              <div className="flex items-center gap-2 flex-shrink-0">
                <SidebarTrigger className="-ml-1" />
                <div className="hidden md:flex items-center gap-2 text-muted-foreground text-xs">
                  <Bot size={14} />
                  <span>Vibe Admin</span>
                  <ChevronRight size={12} />
                  <span className="capitalize">{section}</span>
                  <ChevronRight size={12} />
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    role === 'super_admin' ? 'bg-purple-100 text-purple-800' : 
                    role === 'admin' ? 'bg-blue-100 text-blue-800' : 
                    role === 'moderator' ? 'bg-green-100 text-green-800' : 
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {role === 'super_admin' ? '👑 Super Admin' : 
                     role === 'admin' ? '🛡️ Admin' : 
                     role === 'moderator' ? '🔧 Moderator' : 
                     '👁️ Viewer'}
                  </span>
                  <span className={`ml-2 inline-flex items-center gap-1 ${connected ? 'text-green-600' : 'text-red-600'}`}>
                    <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
                    {connected ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-1 justify-end">
                <div className="relative flex-1 max-w-md group">
                  <Input 
                    value={globalSearch} 
                    onChange={(e) => setGlobalSearch(e.target.value)} 
                    placeholder="Search users by id, username, name..." 
                    className="pl-10 pr-4 h-10 bg-muted/30 border-border/50 focus:border-primary/50 focus:bg-background transition-all duration-200 rounded-lg shadow-sm"
                    onKeyDown={(e) => { if (e.key === "Enter") { setSection("users"); setUsersQuery((prev) => ({ ...prev, q: globalSearch, page: 1 })); } }} 
                  />
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button variant="outline" size="sm" onClick={() => { setSection("users"); setUsersQuery((prev) => ({ ...prev, q: globalSearch, page: 1 })); }} className="interactive hidden md:flex">
                    <Search className="h-4 w-4 mr-2" />
                    Search
                  </Button>
                  <Button variant="ghost" size="icon" onClick={refresh} className="interactive">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button variant="destructive" size="sm" onClick={logout} className="interactive shadow-lg shadow-destructive/20">
                    <LogOut className="h-4 w-4 mr-2" /> 
                    Logout
                  </Button>
                </div>
              </div>
            </div>
          </header>
          {!connected && (
            <div className="px-4 md:px-6 py-2 bg-destructive/10 text-destructive text-sm flex items-center justify-between">
              <span>Server disconnected</span>
              <Button variant="outline" size="sm" onClick={refresh}>Retry</Button>
            </div>
          )}
          <main className="flex-1 overflow-y-auto">
            <div className="container mx-auto px-4 md:px-6 py-6 space-y-6">
            {section === "dashboard" && <Dashboard cards={cards} />}
            {section === "users" && (
              <UsersView
                meRole={role}
                canExport={canExport}
                canManageUsers={canManageUsers}
                usersQuery={usersQuery}
                setUsersQuery={setUsersQuery}
              />
            )}
            {section === "tasks" && (
              <TasksView canManageTasks={canManageTasks} />
            )}
            {section === "submissions" && (
              <SubmissionsView canModerate={canModerate} />
            )}
            {section === "blocked_users" && (
              <BlockedUsersView canManageUsers={canManageUsers} />
            )}
            {section === "security" && (
              <SecurityView canManageUsers={canManageUsers} />
            )}
            {section === "support" && (
              <SupportView canModerate={canModerate} />
            )}
            {section === "broadcasts" && (
              <BroadcastsView canSend={canSendBroadcast} />
            )}
            {section === "claims" && (
              <ClaimAnalyticsView />
            )}
            {section === "referrals" && (
              <ReferralsView />
            )}
            {section === "wallet" && (
              <WalletView canApprove={canManageUsers} />
            )}
            {section === "database" && (
              <DatabaseView canView={true} canAdmin={role === 'admin' || role === 'super_admin'} isSuperAdmin={isSuperAdmin} />
            )}
            {section === "logs" && <LogViewer />}
            {section === "bot_monitor" && <BotMonitor />}
            {section === "settings" && (
              <AdminSettingsView canView={canViewAdminSettings} isSuperAdmin={isSuperAdmin} />
            )}
            {section === "admin_control" && (
              <AdminControlView canManageTasks={canManageTasks} />
            )}
            </div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

function Dashboard({ cards }: { cards: Array<{ title: string; value: number; icon: any; color?: string }> }) {
  return (
    <div className="dashboard-container animate-fade-in">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard Overview</h1>
        <p className="text-muted-foreground mt-2">Welcome back! Here's what's happening with your bot today.</p>
      </div>
      <section className="dashboard-grid">
        {cards.map((c, i) => (
          <Card key={i} className="relative overflow-hidden bg-gradient-to-br from-background via-background to-primary/5 border-border/60 hover:shadow-lg transition-all duration-300 group interactive">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <CardHeader className="pb-2 relative">
              <CardTitle className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">{c.title}</span>
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors shadow-sm">
                  <c.icon className={`h-5 w-5 ${c.color || 'text-primary'}`} />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="relative">
              <div className={`text-3xl font-bold tabular-nums ${c.color || 'text-foreground'}`}>
                {Intl.NumberFormat().format(c.value)}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">Updated just now</div>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}

function ClaimAnalyticsView() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const numberFormatter = useMemo(() => new Intl.NumberFormat(), []);
  const tokenFormatter = useMemo(() => new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }), []);
  const percentFormatter = useMemo(() => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }), []);

  useEffect(() => {
    void load(true);
  }, []);

  async function load(initial = false) {
    initial ? setLoading(true) : setRefreshing(true);
    try {
      const res = await api<any>(`/analytics/claims`);
      setData((res as any)?.data ?? res);
      setError(null);
    } catch (err: any) {
      const message = err?.message || 'Failed to load claim analytics';
      setError(message);
      toast.error(message);
    } finally {
      if (initial) setLoading(false);
      else setRefreshing(false);
    }
  }

  const tokenLabel = data?.tokenSymbol || 'tokens';
  const formatNumber = (value: number | null | undefined) => (value === null || value === undefined ? '—' : numberFormatter.format(value));
  const formatTokens = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${tokenFormatter.format(value)} ${tokenLabel}`);
  const formatPercent = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${percentFormatter.format(value)}%`);

  const totalAvailableTokens = data?.contractBalanceTokens != null ? data.contractBalanceTokens + data.totalClaimedTokens : null;
  const trendData = Array.isArray(data?.trend) ? data!.trend.slice(-10) : [];
  const maxTrendTokens = trendData.reduce((max: number, row: any) => Math.max(max, Number(row.totalTokens ?? 0)), 0) || 1;

  const eligibleShare = data?.eligibleUsers && data?.totalUsers ? (data.eligibleUsers / data.totalUsers) * 100 : null;
  const walletShare = data?.walletUsers && data?.totalUsers ? (data.walletUsers / data.totalUsers) * 100 : null;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 rounded bg-muted/40 animate-pulse" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-dashed">
              <CardContent className="p-6 space-y-3">
                <div className="h-4 w-24 bg-muted/40 rounded animate-pulse" />
                <div className="h-8 w-32 bg-muted/30 rounded animate-pulse" />
                <div className="h-3 w-full bg-muted/20 rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="h-48 bg-muted/20 rounded animate-pulse" />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <PieChart className="h-5 w-5" />
            Claim analytics unavailable
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-destructive/90">{error}</p>
          <Button onClick={() => load(true)} variant="destructive">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const summaryCards = [
    {
      title: 'Contract Balance',
      value: formatTokens(data?.contractBalanceTokens),
      description: data?.contractBalanceRaw ? `Raw: ${data.contractBalanceRaw}` : 'Tokens currently held in claim contract',
      icon: Coins,
    },
    {
      title: 'Total Claimed',
      value: formatTokens(data?.totalClaimedTokens),
      description: `${formatNumber(data?.totalClaims)} total claims processed`,
      icon: TrendingUp,
    },
    {
      title: 'Claim Progress',
      value: formatPercent(data?.percentClaimed),
      description: data?.percentRemaining != null ? `${formatPercent(data.percentRemaining)} remaining` : 'Awaiting distribution data',
      icon: PieChart,
    },
    {
      title: 'Outstanding Tokens',
      value: formatTokens(data?.outstandingTokens),
      description: `${formatNumber(data?.outstandingPoints)} points still unclaimed`,
      icon: Target,
    },
    {
      title: 'Unique Claimers',
      value: formatNumber(data?.uniqueClaimers),
      description: `${formatNumber(data?.totalUsers)} total users`,
      icon: UserCheck,
    },
    {
      title: 'Eligible Users',
      value: formatNumber(data?.eligibleUsers),
      description: walletShare != null ? `${formatPercent(walletShare)} wallet adoption` : 'Wallet readiness data',
      icon: Activity,
    },
  ];

  const lastClaim = data?.lastClaim;
  const lastClaimDate = lastClaim?.processedAt ? new Date(lastClaim.processedAt).toLocaleString() : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <PieChart className="h-6 w-6 text-primary" />
            Claim Analytics
          </h1>
          <p className="text-muted-foreground">
            Deep insights into token redemption, wallet readiness, and distribution health.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => load(false)} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title} className="relative overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Icon className="h-4 w-4 text-primary" />
                  {card.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{card.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Distribution status
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Monitor how much of the allocation has been redeemed and where remaining tokens sit today.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="flex items-center justify-between text-sm font-medium">
                <span>Percent claimed</span>
                <span>{formatPercent(data?.percentClaimed)}</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, Math.max(0, data?.percentClaimed ?? 0))}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {formatPercent(data?.percentRemaining)} remaining in contract
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Avg tokens / claim</div>
                <div className="mt-2 text-lg font-semibold">{formatTokens(data?.averageTokensPerClaim)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Min {formatTokens(data?.minTokensPerClaim)} • Max {formatTokens(data?.maxTokensPerClaim)}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Total available</div>
                <div className="mt-2 text-lg font-semibold">{formatTokens(totalAvailableTokens)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Includes contract balance + all historical claims
                </div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Eligible ratio</div>
                <div className="mt-2 text-lg font-semibold">{formatPercent(eligibleShare)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatNumber(data?.walletUsers)} wallets connected
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-primary" />
              Latest claim
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Snapshot of the most recent completed claim transaction.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {lastClaim ? (
              <>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">User ID</div>
                  <div className="text-sm font-medium">{lastClaim.userId}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Wallet</div>
                  <div className="text-sm font-mono">
                    {lastClaim.walletAddress ? `${lastClaim.walletAddress.slice(0, 6)}…${lastClaim.walletAddress.slice(-4)}` : '—'}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-md bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground">Tokens</div>
                    <div className="font-semibold">{formatTokens(lastClaim.tokenAmount)}</div>
                  </div>
                  <div className="rounded-md bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground">Points</div>
                    <div className="font-semibold">{formatNumber(lastClaim.points)}</div>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Processed</div>
                  <div className="text-sm font-medium">{lastClaimDate}</div>
                </div>
                {lastClaim.transactionHash && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Transaction hash</div>
                    <div className="text-xs font-mono break-all text-muted-foreground">{lastClaim.transactionHash}</div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                No completed claims have been recorded yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Top claimers
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Biggest token recipients ranked by cumulative claim volume.
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Claims</TableHead>
                    <TableHead>Wallet</TableHead>
                    <TableHead>Last claim</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.isArray(data?.topClaimers) && data!.topClaimers.length > 0 ? (
                    data!.topClaimers.map((row: any) => (
                      <TableRow key={row.userId}>
                        <TableCell className="font-medium">{row.userId}</TableCell>
                        <TableCell>{formatTokens(row.totalTokens)}</TableCell>
                        <TableCell>{formatNumber(row.totalClaims)}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.walletAddress ? `${row.walletAddress.slice(0, 6)}…${row.walletAddress.slice(-4)}` : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.lastClaimAt ? new Date(row.lastClaimAt).toLocaleString() : '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                        No claim history available.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              30-day trend
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Daily token volume and claim counts over the past month.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {trendData.length > 0 ? (
              trendData.map((row: any) => {
                const tokenValue = Number(row.totalTokens ?? 0);
                const claimValue = Number(row.totalClaims ?? 0);
                const barWidth = Math.max(4, Math.min(100, (tokenValue / maxTrendTokens) * 100));
                return (
                  <div key={row.date} className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{row.date}</span>
                      <span>{formatNumber(claimValue)} claims</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary/70" style={{ width: `${barWidth}%` }} />
                    </div>
                    <div className="text-xs font-medium">{formatTokens(tokenValue)}</div>
                  </div>
                );
              })
            ) : (
              <div className="text-sm text-muted-foreground">
                No claim activity recorded in the last 30 days.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SupportView({ canModerate }: { canModerate: boolean }) {
  const [loading, setLoading] = useState(false);
  const [tickets, setTickets] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [status, setStatus] = useState<string>('all');
  const [category, setCategory] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [selectedTicket, setSelectedTicket] = useState<any | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');
  const [stats, setStats] = useState<any | null>(null);
  const [showTestBroadcast, setShowTestBroadcast] = useState(false);
  const [testUserId, setTestUserId] = useState('');
  const [testMessage, setTestMessage] = useState('');

  useEffect(() => { 
    void loadTickets(); 
    void loadStats();
  }, [page, status, category, search]);

  async function loadTickets() {
    if (!canModerate) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (status !== 'all') params.set('status', status);
      if (category !== 'all') params.set('category', category);
      if (search) params.set('search', search);
      
      const res = await api<any>(`/support/tickets?${params.toString()}`);
      setTickets(res.data || []);
      setTotal(res.total || 0);
    } catch {
      toast.error('Failed to load support tickets');
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    if (!canModerate) return;
    try {
      const res = await api<any>('/support/stats');
      setStats(res.data || null);
    } catch {
      console.warn('Failed to load support stats');
    }
  }

  async function viewTicket(ticketId: string) {
    try {
      const res = await api<any>(`/support/tickets/${ticketId}`);
      setSelectedTicket(res.data);
    } catch {
      toast.error('Failed to load ticket details');
    }
  }

  async function sendReply(ticketId: string) {
    if (!replyMessage.trim()) {
      toast.error('Reply message is required');
      return;
    }
    
    const loadingToast = toast.loading('Sending reply...');
    
    try {
      const response = await api<any>(`/support/tickets/${ticketId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message: replyMessage.trim() })
      });
      
      console.log('Reply response:', response);
      
      toast.dismiss(loadingToast);
      toast.success(`Reply sent successfully to ${response.userName || 'user'}`);
      
      setReplyOpen(false);
      setReplyMessage('');
      void loadTickets();
      
      // Update selected ticket if it's the one we replied to
      if (selectedTicket?.id === ticketId) {
        await viewTicket(ticketId);
      }
    } catch (error: any) {
      toast.dismiss(loadingToast);
      console.error('Reply error:', error);
      
      let errorMessage = 'Failed to send reply';
      try {
        if (typeof error === 'string') {
          errorMessage = error;
        } else if (error.message) {
          errorMessage = error.message;
        } else if (error.response?.text) {
          const text = await error.response.text();
          const parsed = JSON.parse(text);
          errorMessage = parsed.message || errorMessage;
        }
      } catch {
        // Use default error message
      }
      
      toast.error(errorMessage);
    }
  }

  async function updateTicketStatus(ticketId: string, newStatus: string) {
    try {
      await api(`/support/tickets/${ticketId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus })
      });
      
      toast.success('Ticket status updated');
      void loadTickets();
      
      // Update selected ticket if it's the one we updated
      if (selectedTicket?.id === ticketId) {
        await viewTicket(ticketId);
      }
    } catch {
      toast.error('Failed to update ticket status');
    }
  }

  async function sendTestBroadcast() {
    if (!testUserId.trim() || !testMessage.trim()) {
      toast.error('User ID and message are required');
      return;
    }
    
    try {
      const response = await api<any>('/support/test-broadcast', {
        method: 'POST',
        body: JSON.stringify({ 
          userId: testUserId.trim(), 
          message: testMessage.trim() 
        })
      });
      
      toast.success('Test broadcast sent successfully');
      setShowTestBroadcast(false);
      setTestUserId('');
      setTestMessage('');
      console.log('Test broadcast response:', response);
    } catch (error: any) {
      console.error('Test broadcast error:', error);
      toast.error('Failed to send test broadcast');
    }
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      open: 'bg-blue-100 text-blue-800 border-blue-200',
      in_progress: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      replied: 'bg-green-100 text-green-800 border-green-200',
      resolved: 'bg-purple-100 text-purple-800 border-purple-200',
      closed: 'bg-gray-100 text-gray-800 border-gray-200'
    };
    return variants[status] || variants.open;
  };

  const getCategoryIcon = (category: string) => {
    const icons: Record<string, string> = {
      account: '👤',
      technical: '⚙️',
      ban: '🚫',
      business: '💼',
      general: '❓'
    };
    return icons[category] || icons.general;
  };

  if (!canModerate) {
    return (
      <div className="text-center py-10">
        <MessageCircle className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">Access Restricted</h3>
        <p className="text-muted-foreground">You need moderator permissions to access support tickets.</p>
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col space-y-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Support Center</h1>
          <p className="text-muted-foreground mt-2">Manage and respond to user support tickets</p>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-xs text-muted-foreground">Total Tickets</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-blue-600">{stats.byStatus.open}</div>
                <div className="text-xs text-muted-foreground">Open</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-yellow-600">{stats.byStatus.inProgress}</div>
                <div className="text-xs text-muted-foreground">In Progress</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-green-600">{stats.byStatus.replied}</div>
                <div className="text-xs text-muted-foreground">Replied</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-purple-600">{stats.byStatus.resolved}</div>
                <div className="text-xs text-muted-foreground">Resolved</div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-64">
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tickets by message, username, or ticket ID..."
                className="mt-1"
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-40 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="replied">Replied</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-40 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="account">Account</SelectItem>
                  <SelectItem value="technical">Technical</SelectItem>
                  <SelectItem value="ban">Ban Appeal</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={() => void loadTickets()} variant="outline">
                <RefreshCw className="h-4 w-4 mr-2" />
                Reload
              </Button>
              {canModerate && (
                <Button onClick={() => setShowTestBroadcast(true)} variant="outline" size="sm">
                  🧪 Test Broadcast
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tickets Table */}
      <Card>
        <CardHeader>
          <CardTitle>Support Tickets</CardTitle>
          <p className="text-sm text-muted-foreground">
            Showing {tickets.length} of {total} tickets
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <TableLoadingSkeleton />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Message Preview</TableHead>
                    <TableHead className="w-40">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.map((ticket) => (
                    <TableRow key={ticket.id}>
                      <TableCell className="font-mono text-xs">
                        {ticket.id.slice(-8)}
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{ticket.firstName || 'Unknown'}</div>
                          <div className="text-xs text-muted-foreground">
                            @{ticket.username || 'N/A'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            ID: {ticket.userId}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span>{getCategoryIcon(ticket.category)}</span>
                          <span className="capitalize">{ticket.categoryLabel || ticket.category}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${getStatusBadge(ticket.status)} capitalize`}>
                          {ticket.status?.replace('_', ' ') || 'open'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {new Date(ticket.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-xs truncate text-sm">
                          {ticket.message}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => viewTicket(ticket.id)}
                          >
                            View
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => {
                                setSelectedTicket(ticket);
                                setReplyOpen(true);
                              }}>
                                Reply
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => updateTicketStatus(ticket.id, 'in_progress')}>
                                Mark In Progress
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => updateTicketStatus(ticket.id, 'resolved')}>
                                Mark Resolved
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => updateTicketStatus(ticket.id, 'closed')}>
                                Mark Closed
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {tickets.length === 0 && !loading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-10">
                        <MessageCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                        <p className="text-muted-foreground">
                          No support tickets found
                        </p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          
          {/* Pagination */}
          {pages > 1 && (
            <div className="mt-4 flex justify-center">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious 
                      onClick={() => setPage(Math.max(1, page - 1))} 
                      className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <span className="px-4 py-2 text-sm">
                      Page {page} of {pages}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext 
                      onClick={() => setPage(Math.min(pages, page + 1))}
                      className={page === pages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ticket Detail Dialog */}
      <Dialog open={!!selectedTicket} onOpenChange={(open) => !open && setSelectedTicket(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5" />
              Support Ticket Details
            </DialogTitle>
          </DialogHeader>
          
          {selectedTicket && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label>Ticket ID</Label>
                  <div className="font-mono text-xs bg-muted px-2 py-1 rounded mt-1">
                    {selectedTicket.id}
                  </div>
                </div>
                <div>
                  <Label>Status</Label>
                  <div className="mt-1">
                    <Badge className={getStatusBadge(selectedTicket.status)}>
                      {selectedTicket.status?.replace('_', ' ') || 'open'}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label>User</Label>
                  <div className="mt-1">
                    <div className="font-medium">{selectedTicket.firstName}</div>
                    <div className="text-xs text-muted-foreground">
                      @{selectedTicket.username} (ID: {selectedTicket.userId})
                    </div>
                  </div>
                </div>
                <div>
                  <Label>Category</Label>
                  <div className="mt-1 flex items-center gap-1">
                    <span>{getCategoryIcon(selectedTicket.category)}</span>
                    <span>{selectedTicket.categoryLabel || selectedTicket.category}</span>
                  </div>
                </div>
                <div>
                  <Label>Created</Label>
                  <div className="text-xs mt-1">
                    {new Date(selectedTicket.createdAt).toLocaleString()}
                  </div>
                </div>
                {selectedTicket.lastReply && (
                  <div>
                    <Label>Last Reply</Label>
                    <div className="text-xs mt-1">
                      By {selectedTicket.lastReply.adminUser} on{' '}
                      {new Date(selectedTicket.lastReply.sentAt).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>
              
              <div>
                <Label>Message</Label>
                <div className="mt-1 p-3 bg-muted rounded-lg">
                  <p className="text-sm whitespace-pre-wrap">{selectedTicket.message}</p>
                </div>
              </div>
              
              {selectedTicket.lastReply && (
                <div>
                  <Label>Admin Reply</Label>
                  <div className="mt-1 p-3 bg-primary/10 rounded-lg border-l-4 border-primary">
                    <p className="text-sm whitespace-pre-wrap">{selectedTicket.lastReply.message}</p>
                    <div className="text-xs text-muted-foreground mt-2">
                      Sent by {selectedTicket.lastReply.adminUser} on{' '}
                      {new Date(selectedTicket.lastReply.sentAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setReplyOpen(true);
              }}
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              Reply
            </Button>
            <Select 
              value={selectedTicket?.status || 'open'} 
              onValueChange={(status) => selectedTicket && updateTicketStatus(selectedTicket.id, status)}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="replied">Replied</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reply Dialog */}
      <Dialog open={replyOpen} onOpenChange={setReplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reply to Support Ticket</DialogTitle>
          </DialogHeader>
          
          {selectedTicket && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Replying to ticket from <strong>{selectedTicket.firstName}</strong> 
                (@{selectedTicket.username})
              </div>
              
              <div>
                <Label htmlFor="reply-message">Your Reply</Label>
                <Textarea
                  id="reply-message"
                  value={replyMessage}
                  onChange={(e) => setReplyMessage(e.target.value)}
                  placeholder="Type your reply here..."
                  rows={6}
                  className="mt-1"
                />
              </div>
              
              <div className="text-xs text-muted-foreground">
                This reply will be sent directly to the user via Telegram.
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => selectedTicket && sendReply(selectedTicket.id)}>
              Send Reply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Test Broadcast Dialog */}
      <Dialog open={showTestBroadcast} onOpenChange={setShowTestBroadcast}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>🧪 Test Broadcast</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Send a test message to verify the broadcast system is working.
            </div>
            
            <div>
              <Label htmlFor="test-user-id">User ID</Label>
              <Input
                id="test-user-id"
                value={testUserId}
                onChange={(e) => setTestUserId(e.target.value)}
                placeholder="Enter Telegram user ID (e.g., 123456789)"
                className="mt-1"
              />
            </div>
            
            <div>
              <Label htmlFor="test-message">Test Message</Label>
              <Textarea
                id="test-message"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                placeholder="Enter test message..."
                rows={3}
                className="mt-1"
              />
            </div>
            
            <div className="text-xs text-muted-foreground">
              ⚠️ This will send a real message to the specified user.
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTestBroadcast(false)}>
              Cancel
            </Button>
            <Button onClick={sendTestBroadcast}>
              Send Test Message
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{Intl.NumberFormat().format(value ?? 0)}</div>
    </div>
  );
}

function UsersView({ meRole, canExport, canManageUsers, usersQuery, setUsersQuery }: { meRole: string; canExport: boolean; canManageUsers: boolean; usersQuery: { q?: string; verified?: string; blocked?: string; hasWallet?: string; page: number; pageSize: number }; setUsersQuery: (u: any) => void }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<any | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgType, setMsgType] = useState<'text'|'image'>('text');
  const [msgText, setMsgText] = useState('');
  const [msgMediaUrl, setMsgMediaUrl] = useState('');
  const [adjustDelta, setAdjustDelta] = useState<string>("");
  const [adjustReason, setAdjustReason] = useState<string>("");

  useEffect(() => { void load(); }, [usersQuery.q, usersQuery.verified, usersQuery.blocked, usersQuery.hasWallet, usersQuery.page, usersQuery.pageSize]);

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (usersQuery.q) qs.set("q", usersQuery.q);
      if (usersQuery.verified !== undefined) qs.set("verified", String(usersQuery.verified ?? ""));
      if (usersQuery.blocked !== undefined) qs.set("blocked", String(usersQuery.blocked ?? ""));
      if (usersQuery.hasWallet !== undefined) qs.set("hasWallet", String(usersQuery.hasWallet ?? ""));
      qs.set("page", String(usersQuery.page));
      qs.set("pageSize", String(usersQuery.pageSize));
      const res = await api<any>(`/users?${qs.toString()}`);
      setRows(res.data || []);
      setTotal(res.total || 0);
    } catch { toast.error("Failed to load users"); } finally { setLoading(false); }
  }

  async function openDetails(id: string) {
    try { const res = await api<any>(`/users/${id}`); setSelected(res.user || null); } catch { toast.error("Failed to load user"); }
  }

  async function exportCsv() {
    try {
      const qs = new URLSearchParams();
      if (usersQuery.q) qs.set("q", usersQuery.q);
      if (usersQuery.verified !== undefined) qs.set("verified", String(usersQuery.verified ?? ""));
      if (usersQuery.blocked !== undefined) qs.set("blocked", String(usersQuery.blocked ?? ""));
      if (usersQuery.hasWallet !== undefined) qs.set("hasWallet", String(usersQuery.hasWallet ?? ""));
      const text = await api<string>(`/users/export?${qs.toString()}`);
      const blob = new Blob([text as any], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "users.csv"; link.click(); URL.revokeObjectURL(url);
    } catch { toast.error("Export failed"); }
  }

  async function blockUser(id: string) {
    try { await api(`/users/${id}/block`, { method: "POST", body: JSON.stringify({ reason: "blocked by admin" }) }); toast.success("User blocked"); void load(); } catch { toast.error("Failed to block"); }
  }
  async function unblockUser(id: string) {
    try { await api(`/users/${id}/unblock`, { method: "POST", body: JSON.stringify({ reason: "unblocked by admin" }) }); toast.success("User unblocked"); void load(); } catch { toast.error("Failed to unblock"); }
  }
  async function sendMessage(id: string) {
    if (msgType === 'text' && !msgText.trim()) { toast.error('Message required'); return; }
    if (msgType === 'image' && !msgMediaUrl.trim()) { toast.error('Image URL required'); return; }
    try {
      await api(`/users/${id}/message`, { method: 'POST', body: JSON.stringify({ type: msgType, message: msgText, mediaUrl: msgMediaUrl || undefined }) });
      toast.success('Queued'); setMsgOpen(false); setMsgText(''); setMsgMediaUrl('');
    } catch { toast.error('Failed to queue'); }
  }

  async function adjustPoints(id: string) {
    const delta = Number(adjustDelta);
    if (!delta || isNaN(delta) || delta === 0) { toast.error("Enter a non-zero number"); return; }
    try { await api(`/users/${id}/points`, { method: "POST", body: JSON.stringify({ delta, reason: adjustReason || "Admin adjustment" }) }); toast.success("Points updated"); setAdjustOpen(false); setAdjustDelta(""); setAdjustReason(""); void load(); } catch { toast.error("Failed to update points"); }
  }

  const pages = Math.max(1, Math.ceil(total / (usersQuery.pageSize || 20)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full md:max-w-xs">
          <Label>Search</Label>
          <Input value={usersQuery.q || ""} onChange={(e) => setUsersQuery((prev: any) => ({ ...prev, q: e.target.value, page: 1 }))} placeholder="id, username, name..." />
        </div>
        <div>
          <Label>Status</Label>
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Filters</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => setUsersQuery((p: any) => ({ ...p, verified: p.verified === "true" ? "" : "true", page: 1 }))}>Verified</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setUsersQuery((p: any) => ({ ...p, blocked: p.blocked === "true" ? "" : "true", page: 1 }))}>Blocked</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setUsersQuery((p: any) => ({ ...p, hasWallet: p.hasWallet === "true" ? "" : "true", page: 1 }))}>With Wallet</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => setUsersQuery({ q: "", page: 1, pageSize: usersQuery.pageSize })}>Clear</Button>
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          {canExport && (
            <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2" /> Export CSV</Button>
          )}
          <Button variant="outline" onClick={() => void load()}>Reload</Button>
        </div>
      </div>
      <Card className="card-enhanced animate-slide-up">
        <CardHeader className="flex-row items-center justify-between pb-4">
          <div>
            <CardTitle className="text-xl font-semibold">Users</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Manage and monitor all users</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="px-3 py-1">
              <Users className="h-3 w-3 mr-1" />
              {Intl.NumberFormat().format(total)} total
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <Table className="table-enhanced">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/40 border-b">
                  <TableHead className="font-semibold">Name</TableHead>
                  <TableHead className="font-semibold">Username</TableHead>
                  <TableHead className="font-semibold">Telegram ID</TableHead>
                  <TableHead className="text-right font-semibold">Points</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">Wallet</TableHead>
                  <TableHead className="w-56 font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => (
                  <TableRow key={u.id || u.telegramId}>
                    <TableCell className="min-w-[160px]">
                      <div className="font-medium">{u.firstName} {u.lastName || ""}</div>
                      <div className="text-xs text-muted-foreground">{new Date(u.joinedAt || u.createdAt || Date.now()).toLocaleDateString()}</div>
                    </TableCell>
                    <TableCell>@{u.username || ""}</TableCell>
                    <TableCell>{u.telegramId}</TableCell>
                    <TableCell className="text-right tabular-nums">{Intl.NumberFormat().format(u.points || 0)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1.5 flex-wrap">
                        {u.isVerified && <Badge variant="secondary" className="shadow-sm">✓ Verified</Badge>}
                        {u.isBlocked && <Badge variant="destructive" className="shadow-sm">⛔ Blocked</Badge>}
                        {u.isPremium && <Badge className="bg-gradient-to-r from-yellow-500 to-yellow-600 shadow-md">⭐ Premium</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{u.walletAddress ? `${u.walletAddress.slice(0,6)}…${u.walletAddress.slice(-4)}` : ""}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => openDetails(u.id || u.telegramId)}>View</Button>
                        {canManageUsers && (
                          <>
                            {!u.isBlocked ? (
                              <Button size="sm" variant="destructive" onClick={() => blockUser(u.id || u.telegramId)}>Block</Button>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => unblockUser(u.id || u.telegramId)}>Unblock</Button>
                            )}
                            <Button size="sm" onClick={() => { setSelected(u); setAdjustOpen(true); }}>Adjust</Button>
                        <Button size="sm" variant="outline" onClick={() => { setSelected(u); setMsgOpen(true); }}>Message</Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {loading && (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`}>
                      <TableCell><div className="skeleton h-4 w-32" /></TableCell>
                      <TableCell><div className="skeleton h-4 w-24" /></TableCell>
                      <TableCell><div className="skeleton h-4 w-28" /></TableCell>
                      <TableCell><div className="skeleton h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><div className="skeleton h-6 w-20 rounded-full" /></TableCell>
                      <TableCell><div className="skeleton h-4 w-24" /></TableCell>
                      <TableCell><div className="flex gap-2"><div className="skeleton h-8 w-16" /><div className="skeleton h-8 w-16" /></div></TableCell>
                    </TableRow>
                  ))
                )}
                {!loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">No users found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between pt-4">
            <div className="text-xs text-muted-foreground">Page {usersQuery.page} of {pages}</div>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious onClick={() => usersQuery.page > 1 && setUsersQuery((p: any) => ({ ...p, page: p.page - 1 }))} />
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext onClick={() => usersQuery.page < pages && setUsersQuery((p: any) => ({ ...p, page: p.page + 1 }))} />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </CardContent>
      </Card>
      <Drawer open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DrawerContent className="p-0">
          <DrawerHeader className="px-6 pt-6">
            <DrawerTitle>User Details</DrawerTitle>
          </DrawerHeader>
          <div className="px-6 pb-6">
            {selected ? (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div><span className="text-muted-foreground">ID:</span> {selected.telegramId}</div>
                    <div><span className="text-muted-foreground">Name:</span> {selected.firstName} {selected.lastName || ""}</div>
                    <div><span className="text-muted-foreground">Username:</span> @{selected.username || ""}</div>
                    <div><span className="text-muted-foreground">Points:</span> {Intl.NumberFormat().format(selected.points || 0)}</div>
                    {canManageUsers && (
                      <div className="flex gap-2 pt-2">
                        {!selected.isBlocked ? (
                          <Button size="sm" variant="destructive" onClick={() => { void blockUser(selected.id || selected.telegramId); }}>
                            Block
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => { void unblockUser(selected.id || selected.telegramId); }}>
                            Unblock
                          </Button>
                        )}
                        <Button size="sm" onClick={() => setAdjustOpen(true)}>Adjust Points</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Flags</CardTitle></CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {selected.isVerified && <Badge variant="secondary">Verified</Badge>}
                    {selected.isBlocked && <Badge variant="destructive">Blocked</Badge>}
                    {selected.isPremium && <Badge>Premium</Badge>}
                    {selected.walletAddress && <Badge>Wallet</Badge>}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Wallet</CardTitle></CardHeader>
                  <CardContent className="text-sm">
                    {selected.walletAddress ? (
                      <div className="break-all">{selected.walletAddress}</div>
                    ) : (
                      <div className="text-muted-foreground">No wallet connected</div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2">
                    <Stat label="Tasks" value={selected.tasksCompleted || 0} />
                    <Stat label="Referrals" value={selected.totalReferrals || 0} />
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading...</div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
      <Dialog open={msgOpen} onOpenChange={setMsgOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send Message</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <Select value={msgType} onValueChange={(v)=>setMsgType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">text</SelectItem>
                  <SelectItem value="image">image</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {msgType === 'image' && (
              <div>
                <Label>Image URL</Label>
                <Input value={msgMediaUrl} onChange={(e)=>setMsgMediaUrl(e.target.value)} placeholder="https://..." />
              </div>
            )}
            <div>
              <Label>Message (HTML allowed)</Label>
              <Textarea rows={5} value={msgText} onChange={(e)=>setMsgText(e.target.value)} placeholder="Write your message..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=>setMsgOpen(false)}>Cancel</Button>
            {selected && <Button onClick={()=>sendMessage(selected.id || selected.telegramId)}>Send</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Points</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Amount</Label>
              <Input type="number" placeholder="e.g. 100 or -50" value={adjustDelta} onChange={(e) => setAdjustDelta(e.target.value)} />
            </div>
            <div>
              <Label>Reason</Label>
              <Input placeholder="Reason" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
            <Button onClick={() => selected && adjustPoints(selected.id || selected.telegramId)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TasksView({ canManageTasks }: { canManageTasks: boolean }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [form, setForm] = useState<any>({ title: "", description: "", category: "social", type: "custom", points: 10, isActive: true, isDaily: false, icon: "⭐", verificationMethod: "manual_review" });

  const categories = ['tele_social','social','premium','daily','engagement','referral'];
  const types = ['telegram_join','twitter_follow','twitter_retweet','instagram_follow','youtube_subscribe','website_visit','premium_check','daily_bonus','referral_invite','mini_game','survey','quiz','captcha','custom'];

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try { const res = await api<any>(`/tasks`); setRows(res.data || []); } catch { toast.error("Failed to load tasks"); } finally { setLoading(false); }
  }

  async function toggle(id: string) {
    try { await api(`/tasks/${id}/toggle`, { method: "POST" }); toast.success("Toggled"); void load(); } catch { toast.error("Failed to toggle"); }
  }

  async function createTask() {
    if (!form.title) { toast.error("Title required"); return; }
    try { await api(`/tasks`, { method: "POST", body: JSON.stringify({ ...form }) }); toast.success("Task created"); setCreateOpen(false); setForm({ title: "", description: "", category: "social", type: "custom", points: 10, isActive: true, isDaily: false, icon: "⭐", verificationMethod: "manual_review" }); void load(); } catch { toast.error("Failed to create"); }
  }

  const filteredRows = rows.filter(t => {
    if (filter !== 'all' && (filter === 'active' ? !t.isActive : t.isActive)) return false;
    if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase()) && !t.description?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: rows.length,
    active: rows.filter(t => t.isActive).length,
    inactive: rows.filter(t => !t.isActive).length,
    totalCompletions: rows.reduce((sum, t) => sum + (t.completionCount || 0), 0),
    totalPoints: rows.reduce((sum, t) => sum + (t.points || 0), 0)
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tasks Management</h1>
            <p className="text-muted-foreground mt-2">Manage and monitor all tasks</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4 mr-2" />Reload</Button>
            {canManageTasks && <Button onClick={() => setCreateOpen(true)}>New Task</Button>}
          </div>
        </div>
        
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total Tasks</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-green-600">{stats.active}</div>
              <div className="text-xs text-muted-foreground">Active</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-gray-600">{stats.inactive}</div>
              <div className="text-xs text-muted-foreground">Inactive</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-blue-600">{Intl.NumberFormat().format(stats.totalCompletions)}</div>
              <div className="text-xs text-muted-foreground">Total Completions</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-purple-600">{Intl.NumberFormat().format(stats.totalPoints)}</div>
              <div className="text-xs text-muted-foreground">Total Rewards</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex-1 min-w-[200px]">
            <Input 
              placeholder="Search tasks..." 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10"
            />
          </div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tasks</SelectItem>
              <SelectItem value="active">Active Only</SelectItem>
              <SelectItem value="inactive">Inactive Only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <Card>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead className="text-right">Completions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-40">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="min-w-[220px]">
                      <div className="font-medium flex items-center gap-2"><span>{t.icon}</span>{t.title}</div>
                      <div className="text-xs text-muted-foreground line-clamp-1">{t.description}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{t.category}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{t.type}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{t.points}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{Intl.NumberFormat().format(t.completionCount || 0)}</TableCell>
                    <TableCell>{t.isActive ? <Badge className="bg-green-500">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {canManageTasks && (
                          <Button size="sm" variant="outline" onClick={() => toggle(t.id)}>{t.isActive ? "Disable" : "Enable"}</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">{loading ? "Loading..." : "No tasks found"}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Task</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <Label>Title</Label>
              <Input value={form.title} onChange={(e) => setForm((f: any) => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <Label>Points</Label>
              <Input type="number" value={form.points} onChange={(e) => setForm((f: any) => ({ ...f, points: Number(e.target.value) }))} />
            </div>
            <div className="md:col-span-2">
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm((f: any) => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f:any)=>({ ...f, category: v }))}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c)=> (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f:any)=>({ ...f, type: v }))}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {types.map((t)=> (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Icon</Label>
              <Input value={form.icon} onChange={(e) => setForm((f: any) => ({ ...f, icon: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            {canManageTasks && <Button onClick={createTask}>Create</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SubmissionsView({ canModerate }: { canModerate: boolean }) {
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);

  useEffect(() => { void load(); }, [page]);

  async function load() {
    try { const res = await api<any>(`/submissions/pending?page=${page}&pageSize=20`); setRows(res.data || []); setTotal(res.total || 0); setSelected(new Set()); } catch { toast.error("Failed to load submissions"); }
  }

  async function approve(s: any) {
    try { await api(`/submissions/${s.id}/approve`, { method: "POST", body: JSON.stringify({ userId: s.userId, taskId: s.taskId, points: s.pointsAwarded || s.points || 0 }) }); toast.success("Approved"); void load(); } catch { toast.error("Approve failed"); }
  }
  async function reject(s: any) {
    try { await api(`/submissions/${s.id}/reject`, { method: "POST", body: JSON.stringify({ reviewNotes: "Rejected by admin" }) }); toast.success("Rejected"); void load(); } catch { toast.error("Reject failed"); }
  }

  function toggleSelect(id: string) {
    const newSet = new Set(selected);
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
    setSelected(newSet);
  }

  function toggleSelectAll() {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map(r => r.id)));
  }

  async function bulkApprove() {
    if (selected.size === 0) { toast.error("No submissions selected"); return; }
    if (!confirm(`Approve ${selected.size} submission(s)?`)) return;
    setBulkProcessing(true);
    let success = 0, failed = 0;
    const selectedRows = rows.filter(r => selected.has(r.id));
    for (const s of selectedRows) {
      try {
        await api(`/submissions/${s.id}/approve`, { method: "POST", body: JSON.stringify({ userId: s.userId, taskId: s.taskId, points: s.pointsAwarded || s.points || 0 }) });
        success++;
      } catch {
        failed++;
      }
    }
    toast.success(`Approved ${success}/${selected.size} submission(s)`);
    if (failed > 0) toast.error(`Failed to approve ${failed} submission(s)`);
    setBulkProcessing(false);
    void load();
  }

  async function bulkReject() {
    if (selected.size === 0) { toast.error("No submissions selected"); return; }
    if (!confirm(`Reject ${selected.size} submission(s)?`)) return;
    setBulkProcessing(true);
    let success = 0, failed = 0;
    const selectedRows = rows.filter(r => selected.has(r.id));
    for (const s of selectedRows) {
      try {
        await api(`/submissions/${s.id}/reject`, { method: "POST", body: JSON.stringify({ reviewNotes: "Bulk rejected by admin" }) });
        success++;
      } catch {
        failed++;
      }
    }
    toast.success(`Rejected ${success}/${selected.size} submission(s)`);
    if (failed > 0) toast.error(`Failed to reject ${failed} submission(s)`);
    setBulkProcessing(false);
    void load();
  }

  const pages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Task Submissions</h1>
          <p className="text-muted-foreground mt-2">{Intl.NumberFormat().format(total)} pending submissions</p>
        </div>
        {canModerate && selected.size > 0 && (
          <div className="flex gap-2">
            <Badge variant="secondary" className="px-3 py-1">{selected.size} selected</Badge>
            <Button 
              variant="default" 
              size="sm" 
              onClick={bulkApprove} 
              disabled={bulkProcessing}
              className="bg-green-600 hover:bg-green-700"
            >
              {bulkProcessing ? "Processing..." : `Approve ${selected.size}`}
            </Button>
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={bulkReject} 
              disabled={bulkProcessing}
            >
              {bulkProcessing ? "Processing..." : `Reject ${selected.size}`}
            </Button>
          </div>
        )}
      </div>
    <Card>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox 
                    checked={selected.size === rows.length && rows.length > 0} 
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>User</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead className="w-40">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={selected.has(r.id) ? 'bg-muted/50' : ''}>
                  <TableCell>
                    <Checkbox 
                      checked={selected.has(r.id)} 
                      onCheckedChange={() => toggleSelect(r.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{r.userId}</div>
                    <div className="text-xs text-muted-foreground">{r.status}</div>
                  </TableCell>
                  <TableCell>{r.taskId}</TableCell>
                  <TableCell>{new Date(r.submittedAt || Date.now()).toLocaleString()}</TableCell>
                  <TableCell className="min-w-[220px] break-all">{r.submissionText || r.metadata?.url || ""}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {canModerate && <Button size="sm" onClick={() => approve(r)}>Approve</Button>}
                      {canModerate && <Button size="sm" variant="destructive" onClick={() => reject(r)}>Reject</Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-sm text-muted-foreground">No pending submissions</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between pt-4">
          <div className="text-xs text-muted-foreground">Page {page} of {pages}</div>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious onClick={() => page > 1 && setPage(page - 1)} />
              </PaginationItem>
              <PaginationItem>
                <PaginationNext onClick={() => page < pages && setPage(page + 1)} />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </CardContent>
    </Card>
    </div>
  );
}

function BlockedUsersView({ canManageUsers }: { canManageUsers: boolean }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<any | null>(null);

  useEffect(() => { void load(); }, [page, searchQuery]);

  async function load() {
    setLoading(true);
    try {
      const res = await api<any>(`/security/blocked-users`);
      let allBlocked = res.data || [];
      
      // Apply search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        allBlocked = allBlocked.filter((u: any) => 
          (u.telegramId || u.userId || u.id || '').toString().includes(q) ||
          (u.username || '').toLowerCase().includes(q) ||
          (u.firstName || '').toLowerCase().includes(q) ||
          (u.lastName || '').toLowerCase().includes(q)
        );
      }
      
      setTotal(allBlocked.length);
      // Manual pagination
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      setRows(allBlocked.slice(start, end));
    } catch { 
      toast.error("Failed to load blocked users"); 
    } finally { 
      setLoading(false); 
    }
  }

  async function unblockUser(u: any) {
    if (!confirm(`Unblock user ${u.firstName || 'Unknown'} (ID: ${u.telegramId || u.userId || u.id})?`)) return;
    try { 
      await api(`/users/${u.telegramId || u.userId || u.id}/unblock`, { 
        method: "POST", 
        body: JSON.stringify({ reason: "unblocked by admin" }) 
      }); 
      toast.success("User unblocked successfully"); 
      void load(); 
    } catch { 
      toast.error("Failed to unblock user"); 
    }
  }

  async function openDetails(u: any) {
    setSelected(u);
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full md:max-w-xs">
          <Label>Search</Label>
          <Input 
            value={searchQuery} 
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }} 
            placeholder="id, username, name..." 
          />
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => void load()}>Reload</Button>
        </div>
      </div>

      <Card className="card-enhanced animate-slide-up">
        <CardHeader className="flex-row items-center justify-between pb-4">
          <div>
            <CardTitle className="text-xl font-semibold">Blocked Users</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Manage users blocked for security violations</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="destructive" className="px-3 py-1">
              <Shield className="h-3 w-3 mr-1" />
              {Intl.NumberFormat().format(total)} blocked
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No blocked users found</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table className="table-enhanced">
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/40 border-b">
                    <TableHead className="font-semibold">Name</TableHead>
                    <TableHead className="font-semibold">Username</TableHead>
                    <TableHead className="font-semibold">Telegram ID</TableHead>
                    <TableHead className="font-semibold">Block Reason</TableHead>
                    <TableHead className="font-semibold">Source</TableHead>
                    <TableHead className="font-semibold">Blocked At</TableHead>
                    <TableHead className="w-48 font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((u) => (
                    <TableRow key={u.id || u.telegramId || u.userId || Math.random()}>
                      <TableCell className="min-w-[160px]">
                        <div className="font-medium">{u.firstName || 'Unknown'} {u.lastName || ""}</div>
                      </TableCell>
                      <TableCell>@{u.username || "N/A"}</TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {u.telegramId || u.userId || u.id}
                        </code>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-xs truncate">{u.blockReason || u.reason || "N/A"}</div>
                      </TableCell>
                      <TableCell>
                        {u.source === 'banned_users' ? (
                          <Badge variant="secondary">Captcha Ban</Badge>
                        ) : u.multiAccountDetected ? (
                          <Badge variant="destructive">Multi-Account</Badge>
                        ) : (
                          <Badge variant="outline">Manual</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs">
                          {u.blockedAt ? new Date(u.blockedAt).toLocaleString() : 'N/A'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => openDetails(u)}>
                            View
                          </Button>
                          {canManageUsers && (
                            <Button size="sm" variant="default" onClick={() => unblockUser(u)}>
                              Unblock
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex justify-center">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious onClick={() => page > 1 && setPage(page - 1)} />
              </PaginationItem>
              {Array.from({ length: Math.min(5, pages) }, (_, i) => {
                const p = i + 1;
                return (
                  <PaginationItem key={p}>
                    <PaginationLink onClick={() => setPage(p)} isActive={p === page}>
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                );
              })}
              {pages > 5 && <PaginationItem><PaginationEllipsis /></PaginationItem>}
              <PaginationItem>
                <PaginationNext onClick={() => page < pages && setPage(page + 1)} />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      {/* Details Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Blocked User Details</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Name</Label>
                  <div className="font-medium">{selected.firstName || 'Unknown'} {selected.lastName || ''}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Username</Label>
                  <div>@{selected.username || 'N/A'}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Telegram ID</Label>
                  <div><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{selected.telegramId || selected.userId || selected.id}</code></div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Blocked At</Label>
                  <div className="text-sm">{selected.blockedAt ? new Date(selected.blockedAt).toLocaleString() : 'N/A'}</div>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">Block Reason</Label>
                  <div className="text-sm">{selected.blockReason || selected.reason || 'N/A'}</div>
                </div>
                {selected.originalUser && (
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">Original User (Device Owner)</Label>
                    <div className="text-sm"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{selected.originalUser}</code></div>
                  </div>
                )}
                {selected.deviceHash && (
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">Device Hash</Label>
                    <div className="text-xs break-all"><code className="bg-muted px-1.5 py-0.5 rounded">{selected.deviceHash}</code></div>
                  </div>
                )}
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">Source</Label>
                  <div>
                    {selected.source === 'banned_users' ? (
                      <Badge variant="secondary">Banned from Captcha (banned_users collection)</Badge>
                    ) : (
                      <Badge variant="outline">Blocked in Users Collection</Badge>
                    )}
                  </div>
                </div>
              </div>
              {canManageUsers && (
                <DialogFooter className="mt-4">
                  <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
                  <Button onClick={() => { unblockUser(selected); setSelected(null); }}>
                    Unblock User
                  </Button>
                </DialogFooter>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SecurityView({ canManageUsers }: { canManageUsers: boolean }) {
  const [audit, setAudit] = useState<any[]>([]);
  const [captcha, setCaptcha] = useState<any | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    try {
      const [a, c] = await Promise.all([
        api<any>(`/security/audit?page=1&pageSize=20`),
        api<any>(`/security/captcha-stats`),
      ]);
      setAudit(a.data || []);
      setCaptcha(c.data || null);
    } catch { toast.error("Failed to load security data"); }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Security Audit (latest)</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {audit.map((e, i) => (
              <div key={i} className="rounded border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{e.type}</div>
                  <Badge variant={e.severity === 'high' || e.severity === 'critical' ? 'destructive' : 'secondary'}>{e.severity}</Badge>
                </div>
                <div className="text-muted-foreground text-xs mt-1">{new Date(e.timestamp || e.loggedAt || Date.now()).toLocaleString()}</div>
                <div className="mt-2 text-sm">{e.description}</div>
              </div>
            ))}
            {audit.length === 0 && <div className="text-sm text-muted-foreground">No recent events</div>}
          </div>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Captcha Stats</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Stat label="Total" value={captcha?.totalSessions} />
            <Stat label="Success" value={captcha?.successfulSessions} />
            <Stat label="Failed" value={captcha?.failedSessions} />
            <Stat label="Success Rate %" value={Math.round(captcha?.successRate || 0)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BroadcastsView({ canSend }: { canSend: boolean }) {
  const [type, setType] = useState<'text'|'image'>('text');
  const [message, setMessage] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [seg, setSeg] = useState<any>({ 
    verified: false, 
    premium: false, 
    hasWallet: false, 
    hasReferrals: false, 
    includeBlocked: false,
    includeBanned: false,
    activeDays: 0, 
    minPoints: '', 
    maxPoints: '' 
  });
  const [history, setHistory] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => { void loadHistory(); }, []);

  async function loadHistory() {
    try { const res = await api<any>(`/broadcasts/history?limit=50`); setHistory(res.data || []); } catch {}
  }

  async function send() {
    if (!canSend) { toast.error('Not permitted'); return; }
    if (type === 'text' && !message.trim()) { toast.error('Message required'); return; }
    if (type === 'image' && !mediaUrl.trim()) { toast.error('Image URL required'); return; }
    
    setIsLoading(true);
    try {
      const payload: any = { type, message, mediaUrl: mediaUrl || undefined, segmentation: { ...seg, minPoints: seg.minPoints !== '' ? Number(seg.minPoints) : undefined, maxPoints: seg.maxPoints !== '' ? Number(seg.maxPoints) : undefined } };
      const res = await api<any>(`/broadcasts/send`, { method: 'POST', body: JSON.stringify(payload) });
      if ((res as any).queued) { 
        toast.success(`🚀 Broadcast queued successfully to ${res.targets} users!`); 
        setMessage(''); 
        setMediaUrl(''); 
        void loadHistory(); 
      } else { 
        toast.warning('📭 No users matched your criteria'); 
      }
    } catch { 
      toast.error('❌ Failed to queue broadcast'); 
    } finally {
      setIsLoading(false);
    }
  }

  const getTargetSummary = () => {
    const filters: string[] = [];
    if (seg.verified) filters.push('✅ Verified');
    if (seg.premium) filters.push('⭐ Premium');
    if (seg.hasWallet) filters.push('💰 Wallet Connected');
    if (seg.hasReferrals) filters.push('🔗 Has Referrals');
    if (seg.includeBlocked) filters.push('🚫 Blocked Users');
    if (seg.includeBanned) filters.push('⛔ Banned Users');
    if (seg.activeDays > 0) filters.push(`📅 Active ${seg.activeDays}d`);
    if (seg.minPoints) filters.push(`📊 Min: ${seg.minPoints} pts`);
    if (seg.maxPoints) filters.push(`📊 Max: ${seg.maxPoints} pts`);
    
    return filters.length ? filters : ['🌍 All Users'];
  };

  const totalBroadcasts = history.length;
  const totalDelivered = history.reduce((sum, entry) => sum + (entry.successCount || 0), 0);
  const totalFailures = history.reduce((sum, entry) => sum + (entry.failureCount || 0), 0);
  const totalTargets = history.reduce((sum, entry) => sum + (entry.targetCount || 0), 0);
  const averageAudience = totalBroadcasts ? Math.round(totalTargets / totalBroadcasts) : 0;
  const successRate = totalTargets ? Math.round((totalDelivered / Math.max(1, totalTargets)) * 100) : 0;
  const lastBroadcast = history[0];
  const lastBroadcastTime = lastBroadcast?.sentAt ? new Date(lastBroadcast.sentAt).toLocaleString() : null;

  const summaryMetrics = [
    {
      title: 'Broadcasts sent',
      value: Intl.NumberFormat().format(totalBroadcasts),
      description: lastBroadcastTime ? `Last sent ${lastBroadcastTime}` : 'No broadcasts queued yet',
      icon: Megaphone,
    },
    {
      title: 'Messages delivered',
      value: Intl.NumberFormat().format(totalDelivered),
      description: `${Intl.NumberFormat().format(totalFailures)} failed`,
      icon: MessageCircle,
    },
    {
      title: 'Average audience',
      value: Intl.NumberFormat().format(averageAudience),
      description: 'Recipients per broadcast',
      icon: Users,
    },
    {
      title: 'Delivery success',
      value: `${successRate}%`,
      description: totalTargets ? `${Intl.NumberFormat().format(totalTargets)} total targets` : 'No delivery data yet',
      icon: TrendingUp,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" />
            Broadcast Center
          </h1>
          <p className="text-muted-foreground">
            Craft targeted campaigns and monitor delivery performance in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadHistory()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh history
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryMetrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.title} className="overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Icon className="h-4 w-4 text-primary" />
                  {metric.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{metric.value}</div>
                <p className="text-xs text-muted-foreground mt-2">{metric.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card className="space-y-6">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" />
              Compose broadcast
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Write your announcement, choose the content format, and send it to a focused audience.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase block mb-2">Message type</Label>
                <Select value={type} onValueChange={(v) => setType(v as any)}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Select message type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">📝 Text message</SelectItem>
                    <SelectItem value="image">🖼️ Image message</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {type === 'image' && (
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground uppercase block mb-2">Image URL</Label>
                  <Input
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                    placeholder="https://example.com/creative.png"
                    className="h-10"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">Message content</Label>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Code className="h-3 w-3" /> HTML allowed • {message.length} chars
                </span>
              </div>
              <Textarea
                rows={8}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={`Write your ${type === 'image' ? 'caption' : 'message'} here. Support for <b>bold</b>, <i>italic</i>, <code>code</code>, and links.`}
                className="font-mono text-sm resize-none"
              />
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {['⏰ Limited-time offer', '🚀 Product launch', '🎉 Community update'].map((template) => (
                  <Badge
                    key={template}
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() => setMessage((prev) => (prev ? `${prev}\n\n${template}` : template))}
                  >
                    {template}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="flex items-center justify-between mb-2 text-sm font-medium">
                <div className="flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-primary" />
                  Live preview
                </div>
                <Badge variant="secondary" className="text-xs">
                  {type === 'image' ? 'Image' : 'Text'}
                </Badge>
              </div>
              <div className="rounded-lg border bg-background p-3 shadow-sm space-y-3">
                {type === 'image' && mediaUrl ? (
                  <img
                    src={mediaUrl}
                    alt="Broadcast preview"
                    className="rounded-md max-h-56 object-cover w-full"
                    onError={(event) => ((event.target as HTMLImageElement).style.display = 'none')}
                  />
                ) : null}
                <div
                  className="text-sm leading-relaxed whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{
                    __html: message.trim() ? message : '<span class="text-muted-foreground">Your message preview will appear here.</span>',
                  }}
                />
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {getTargetSummary().map((tag, idx) => (
                    <Badge key={idx} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <Button
                onClick={send}
                disabled={
                  !canSend ||
                  isLoading ||
                  (type === 'text' && !message.trim()) ||
                  (type === 'image' && (!message.trim() || !mediaUrl.trim()))
                }
                size="lg"
                className="shadow-lg shadow-primary/20"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Megaphone className="h-4 w-4 mr-2" />
                    Send broadcast
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="space-y-4">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4 text-primary" />
                Targeting rules
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Combine filters to reach the right users. All rules are optional.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'verified', label: 'Verified', description: 'Only verified accounts', icon: '✅' },
                  { key: 'premium', label: 'Premium', description: 'Telegram Premium users', icon: '⭐' },
                  { key: 'hasWallet', label: 'Wallet connected', description: 'Users with linked wallets', icon: '💼' },
                  { key: 'hasReferrals', label: 'Has referrals', description: 'Referred other users', icon: '🔗' },
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    <Checkbox
                      checked={seg[item.key]}
                      onCheckedChange={(checked) => setSeg((prev: any) => ({ ...prev, [item.key]: !!checked }))}
                      className="mt-0.5"
                    />
                    <div className="space-y-1">
                      <div className="text-sm font-medium flex items-center gap-2">
                        <span>{item.icon}</span>
                        {item.label}
                      </div>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                  </label>
                ))}
              </div>

              <Separator />

              <div className="grid gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs font-semibold text-muted-foreground uppercase block mb-2">
                      Active within (days)
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      value={seg.activeDays}
                      onChange={(e) => setSeg((prev: any) => ({ ...prev, activeDays: Number(e.target.value || 0) }))}
                      placeholder="0 = everyone"
                      className="h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-muted-foreground uppercase block mb-2">
                      Minimum points
                    </Label>
                    <Input
                      type="number"
                      value={seg.minPoints}
                      onChange={(e) => setSeg((prev: any) => ({ ...prev, minPoints: e.target.value }))}
                      placeholder="No minimum"
                      className="h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-muted-foreground uppercase block mb-2">
                      Maximum points
                    </Label>
                    <Input
                      type="number"
                      value={seg.maxPoints}
                      onChange={(e) => setSeg((prev: any) => ({ ...prev, maxPoints: e.target.value }))}
                      placeholder="No maximum"
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                <div className="grid gap-3">
                  {[
                    {
                      key: 'includeBlocked',
                      label: 'Include blocked users',
                      description: 'Attempt to deliver to users who blocked the bot',
                      tone: 'orange',
                    },
                    {
                      key: 'includeBanned',
                      label: 'Include banned users',
                      description: 'Force delivery to banned accounts',
                      tone: 'red',
                    },
                  ].map((item) => (
                    <label
                      key={item.key}
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${
                        item.tone === 'orange'
                          ? 'border-orange-200 bg-orange-50/30 hover:bg-orange-50'
                          : 'border-red-200 bg-red-50/30 hover:bg-red-50'
                      }`}
                    >
                      <Checkbox
                        checked={seg[item.key]}
                        onCheckedChange={(checked) => setSeg((prev: any) => ({ ...prev, [item.key]: !!checked }))}
                        className="mt-0.5"
                      />
                      <div>
                        <div
                          className={`text-sm font-semibold flex items-center gap-2 ${
                            item.tone === 'orange' ? 'text-orange-600' : 'text-red-600'
                          }`}
                        >
                          ⚠️ {item.label}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                      </div>
                    </label>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    These overrides bypass the normal exclusion rules. Use them only for critical updates.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-primary" />
                Recent broadcasts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {history.slice(0, 8).map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border p-3 transition hover:shadow-sm bg-background/80 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Badge variant="secondary" className="text-xs">
                          {entry.type === 'image' ? 'Image' : 'Text'}
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                          {new Date(entry.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Targeted {Intl.NumberFormat().format(entry.targetCount || 0)} users • Delivered{' '}
                        {Intl.NumberFormat().format(entry.successCount || 0)}
                      </p>
                    </div>
                    <Badge
                      variant={
                        entry.status === 'sent'
                          ? 'default'
                          : entry.status === 'failed'
                          ? 'destructive'
                          : 'secondary'
                      }
                      className="text-xs"
                    >
                      {entry.status}
                    </Badge>
                  </div>
                  <p className="text-sm line-clamp-2 text-muted-foreground">
                    {entry.message || <span className="italic text-muted-foreground/80">No caption provided</span>}
                  </p>
                </div>
              ))}
              {history.length === 0 && (
                <div className="text-center py-10 text-sm text-muted-foreground">
                  No broadcasts yet. Your campaign history will appear here.
                </div>
              )}
              {history.length > 8 && (
                <Button variant="ghost" size="sm" className="w-full text-sm text-primary">
                  View all {history.length} broadcasts
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TableIcon className="h-4 w-4 text-primary" />
            Broadcast history
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Detailed delivery performance for your most recent {history.length || '—'} broadcasts.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Targets</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs">{entry.id.slice(0, 8)}</TableCell>
                    <TableCell>{Intl.NumberFormat().format(entry.targetCount || 0)}</TableCell>
                    <TableCell>{Intl.NumberFormat().format(entry.successCount || 0)}</TableCell>
                    <TableCell>{Intl.NumberFormat().format(entry.failureCount || 0)}</TableCell>
                    <TableCell>{entry.duration ? `${entry.duration} ms` : '—'}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          entry.status === 'sent'
                            ? 'default'
                            : entry.status === 'failed'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {entry.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {history.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">
                      No broadcast history yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReferralsView() {
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any | null>(null);

  useEffect(() => { void load(); }, []);
  async function load() {
    try { const [lb, mt] = await Promise.all([ api<any>(`/referrals/leaderboard?limit=20`), api<any>(`/referrals/metrics`) ]); setLeaderboard(lb.data || []); setMetrics(mt.data || null); } catch {}
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total referrals" value={metrics?.total} />
        <Stat label="Active" value={metrics?.active} />
        <Stat label="Conversion %" value={Math.round((metrics?.conversionRate || 0)*100)} />
      </div>
      <Card>
        <CardHeader><CardTitle>Leaderboard</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referrer</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaderboard.map((r) => (
                  <TableRow key={r.referrerId}>
                    <TableCell>{r.referrerId}</TableCell>
                    <TableCell className="text-right">{r.total}</TableCell>
                    <TableCell className="text-right">{r.active}</TableCell>
                  </TableRow>
                ))}
                {leaderboard.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-10 text-sm text-muted-foreground">No referral data</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function WalletView({ canApprove }: { canApprove: boolean }) {
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [daily, setDaily] = useState<any | null>(null);

  useEffect(() => { void load(); }, [status, page]);

  async function load() {
    try { const res = await api<any>(`/wallet/withdrawals?status=${status}&page=${page}&pageSize=20`); setRows(res.data || []); setTotal(res.total || 0); const d = await api<any>(`/wallet/metrics/daily`); setDaily(d.data || null);} catch {}
  }

  async function approve(id: string) { if (!canApprove) return; try { await api(`/wallet/withdrawals/${id}/approve`, { method: 'POST' }); toast.success('Approved'); void load(); } catch { toast.error('Approve failed'); } }
  async function deny(id: string) { if (!canApprove) return; try { await api(`/wallet/withdrawals/${id}/deny`, { method: 'POST', body: JSON.stringify({ reason: 'Denied by admin' }) }); toast.success('Denied'); void load(); } catch { toast.error('Deny failed'); } }

  const pages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Daily tx" value={daily?.count} />
        <Stat label="Daily amount" value={daily?.totalAmount} />
        <Stat label="Daily tokens" value={daily?.totalTokens} />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v)=>{ setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">pending</SelectItem>
              <SelectItem value="processing">processing</SelectItem>
              <SelectItem value="completed">completed</SelectItem>
              <SelectItem value="failed">failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => void load()}>Reload</Button>
      </div>
      <Card>
        <CardHeader><CardTitle>Withdrawals</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead className="w-40">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>{w.userId}</TableCell>
                    <TableCell className="text-right">{w.amount}</TableCell>
                    <TableCell className="text-right">{w.tokenAmount}</TableCell>
                    <TableCell>{w.status}</TableCell>
                    <TableCell>{new Date(w.requestedAt || Date.now()).toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {canApprove && status === 'pending' && (<>
                          <Button size="sm" onClick={() => approve(w.id)}>Approve</Button>
                          <Button size="sm" variant="destructive" onClick={() => deny(w.id)}>Deny</Button>
                        </>)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-sm text-muted-foreground">No withdrawals</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between pt-4">
            <div className="text-xs text-muted-foreground">Page {page} of {pages}</div>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious onClick={() => page > 1 && setPage(page - 1)} />
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext onClick={() => page < pages && setPage(page + 1)} />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DatabaseView({ canView, canAdmin, isSuperAdmin }: { canView: boolean; canAdmin: boolean; isSuperAdmin: boolean }) {
  if (!canView && !canAdmin && !isSuperAdmin) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <Shield className="h-12 w-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">You don't have permission to view the database</p>
        </CardContent>
      </Card>
    );
  }
  
  return <DatabaseSimpleView />;
}

function AdminSettingsView({ canView, isSuperAdmin }: { canView: boolean; isSuperAdmin: boolean }) {
  // [Implementation truncated for space]
  // The actual AdminSettingsView component would go here
  return <div>Admin Settings View Component (truncated for file size)</div>;
}