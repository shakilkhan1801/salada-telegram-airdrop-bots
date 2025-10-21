import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Activity, TrendingUp, TrendingDown, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const apiBase = (import.meta.env.VITE_API_BASE as string) || 
  (typeof window !== 'undefined' ? `${window.location.origin}/api/admin` : '/api/admin');

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${apiBase}${path}`, { headers, credentials: 'include', ...options });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

interface LogEntry {
  id: string;
  timestamp: string;
  command: string;
  action: string;
  responseTime: number;
  userId: string;
  username?: string;
  success: boolean;
  error?: string;
}

interface Record {
  id: string;
  command: string;
  action: string;
  maxResponseTime: number;
  avgResponseTime: number;
  minResponseTime: number;
  lastResponseTime: number;
  count: number;
  lastOccurrence: string;
}

interface Stats {
  liveLogsCount: number;
  recordsCount: number;
  slowestCommand: Record | null;
  fastestCommand: Record | null;
  averageResponseTime: number;
  liveLogsSizeKB?: number;
  recordsSizeKB?: number;
  liveLogsSizeLimit?: string;
  recordsSizeLimit?: string;
}

export default function BotMonitor() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [records, setRecords] = useState<Record[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [sortBy, setSortBy] = useState<'maxResponseTime' | 'avgResponseTime' | 'count'>('maxResponseTime');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const userScrolledRef = useRef(false);
  const lastScrollTimeRef = useRef(0);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [logsRes, recordsRes, statsRes] = await Promise.all([
        api<{ success: boolean; data: LogEntry[] }>('/bot-performance/live'),
        api<{ success: boolean; data: Record[] }>(`/bot-performance/records?sortBy=${sortBy}`),
        api<{ success: boolean; data: Stats }>('/bot-performance/stats'),
      ]);
      
      setLogs(logsRes.data || []);
      setRecords(recordsRes.data || []);
      setStats(statsRes.data || null);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load data');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const clearData = async () => {
    if (!confirm('Are you sure you want to clear all bot performance data?')) return;
    try {
      await api('/bot-performance/clear', { method: 'POST' });
      toast.success('Data cleared successfully');
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to clear data');
    }
  };

  useEffect(() => {
    void loadData();
  }, [sortBy]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => void loadData(true), 2000);
    return () => clearInterval(interval);
  }, [autoRefresh, sortBy]);

  // Check if user is at bottom of scroll area
  const handleScroll = () => {
    if (!logsContainerRef.current) return;
    
    const now = Date.now();
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
    
    // Detect manual scroll (not programmatic)
    if (now - lastScrollTimeRef.current > 100) {
      userScrolledRef.current = true;
      setShouldAutoScroll(isAtBottom);
    }
    
    lastScrollTimeRef.current = now;
  };

  // Only auto-scroll if user is at bottom AND hasn't manually scrolled away
  useEffect(() => {
    if (!autoRefresh || !shouldAutoScroll) return;
    
    // If user manually scrolled away, don't auto-scroll
    if (userScrolledRef.current && !shouldAutoScroll) return;
    
    // Smooth scroll to bottom
    if (logsEndRef.current && logsContainerRef.current) {
      const { scrollHeight, clientHeight } = logsContainerRef.current;
      // Only scroll if there's actually content to scroll
      if (scrollHeight > clientHeight) {
        logsContainerRef.current.scrollTop = scrollHeight;
      }
    }
  }, [logs, autoRefresh, shouldAutoScroll]);

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getResponseColor = (ms: number) => {
    if (ms < 100) return 'text-green-500';
    if (ms < 500) return 'text-yellow-500';
    if (ms < 1000) return 'text-orange-500';
    return 'text-red-500';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bot Performance Monitor</h1>
          <p className="text-muted-foreground">Real-time bot response time tracking</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant={shouldAutoScroll ? 'default' : 'secondary'} 
            size="sm"
            onClick={() => {
              setShouldAutoScroll(true);
              userScrolledRef.current = false;
              // Immediately scroll to bottom
              if (logsContainerRef.current) {
                logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
              }
            }}
            title={shouldAutoScroll ? 'Auto-scroll enabled' : 'Click to scroll to bottom'}
          >
            {shouldAutoScroll ? '📍 Sticky' : '↓ Bottom'}
          </Button>
          <Button variant={autoRefresh ? 'default' : 'outline'} onClick={() => setAutoRefresh(!autoRefresh)}>
            <Activity className={`h-4 w-4 mr-2 ${autoRefresh ? 'animate-pulse' : ''}`} />
            {autoRefresh ? 'Live' : 'Paused'}
          </Button>
          <Button variant="outline" onClick={() => loadData()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="destructive" onClick={clearData}>
            <Trash2 className="h-4 w-4 mr-2" />
            Clear All
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Records Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Records</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats?.recordsSizeKB !== undefined ? (
                    <>
                      Size: <span className="font-mono font-semibold">{stats.recordsSizeKB} KB</span> / {stats.recordsSizeLimit || '10KB'}
                      {stats.recordsSizeKB > 8 && <span className="text-orange-500 ml-2">⚠️ Near limit</span>}
                    </>
                  ) : (
                    'Max limit: 10KB'
                  )}
                </p>
              </div>
              <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="maxResponseTime">Slowest First</SelectItem>
                  <SelectItem value="avgResponseTime">Avg Response</SelectItem>
                  <SelectItem value="count">Most Used</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-[500px] overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#9ca3af #f3f4f6' }}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-semibold">Command</TableHead>
                    <TableHead className="font-semibold">Action</TableHead>
                    <TableHead className="text-right font-semibold">Max</TableHead>
                    <TableHead className="text-right font-semibold">Avg</TableHead>
                    <TableHead className="text-right font-semibold">Min</TableHead>
                    <TableHead className="text-right font-semibold">Last</TableHead>
                    <TableHead className="text-right font-semibold">Latest</TableHead>
                    <TableHead className="text-right font-semibold">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record) => (
                    <TableRow key={record.id} className="hover:bg-accent/50 transition-colors">
                      <TableCell className="font-mono text-sm font-semibold">{record.command}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-medium">{record.action}</Badge>
                      </TableCell>
                      <TableCell className={`text-right font-mono text-sm font-bold ${getResponseColor(record.maxResponseTime)}`}>
                        {record.maxResponseTime > record.avgResponseTime * 1.5 && (
                          <TrendingUp className="inline h-3 w-3 mr-1 text-red-500" />
                        )}
                        {formatTime(record.maxResponseTime)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-medium text-blue-600">
                        {formatTime(record.avgResponseTime)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-bold text-green-600">
                        {record.minResponseTime < record.avgResponseTime * 0.5 && (
                          <TrendingDown className="inline h-3 w-3 mr-1" />
                        )}
                        {formatTime(record.minResponseTime)}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-sm font-bold ${getResponseColor(record.lastResponseTime)}`}>
                        {formatTime(record.lastResponseTime)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {new Date(record.lastOccurrence).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground font-semibold">
                        <Badge variant="secondary">{record.count}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Live Logs - Terminal Style */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Live Logs</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats?.liveLogsSizeKB !== undefined ? (
                    <>
                      Size: <span className="font-mono font-semibold">{stats.liveLogsSizeKB} KB</span> / {stats.liveLogsSizeLimit || '10KB'}
                      {stats.liveLogsSizeKB > 8 && <span className="text-orange-500 ml-2">⚠️ Near limit</span>}
                    </>
                  ) : (
                    'Max limit: 10KB'
                  )}
                </p>
              </div>
              <Badge variant="secondary">{logs.length} entries</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <div 
              ref={logsContainerRef}
              onScroll={handleScroll}
              className="bg-white border-2 border-border rounded-lg font-mono text-xs p-4 h-[500px] overflow-y-auto shadow-inner"
              style={{ scrollbarWidth: 'thin', scrollbarColor: '#9ca3af #f3f4f6' }}>
              {logs.length === 0 ? (
                <div className="text-muted-foreground text-center py-8">
                  <Activity className="h-8 w-8 mx-auto mb-2 animate-pulse opacity-50" />
                  <p>Waiting for bot activity...</p>
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="mb-2 pb-2 border-b border-border/50 last:border-0 hover:bg-accent/50 px-2 py-1 rounded transition-colors">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs font-mono shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </Badge>
                      <span className={log.success ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                        {log.success ? '✓' : '✗'}
                      </span>
                      <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 font-semibold">
                        {log.command}
                      </Badge>
                      <Badge variant="secondary" className="text-purple-700">
                        {log.action}
                      </Badge>
                      <Badge className={`font-mono font-bold ${getResponseColor(log.responseTime).replace('text-', 'bg-').replace('-500', '-100')} ${getResponseColor(log.responseTime)}`}>
                        {formatTime(log.responseTime)}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        @{log.username || log.userId}
                      </span>
                    </div>
                    {log.error && (
                      <div className="text-red-600 ml-4 text-xs mt-1 bg-red-50 p-1 rounded">
                        ❌ Error: {log.error}
                      </div>
                    )}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
