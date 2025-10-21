import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileDown, RefreshCw, Search, ServerCrash, Copy, Trash2, CheckCircle2 } from "lucide-react";

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

const levelLabels: Record<string, { title: string; color: string; border: string; text: string }> = {
  error: { title: "Error", color: "bg-red-500", border: "border-red-200", text: "text-red-500" },
  warn: { title: "Warning", color: "bg-amber-500", border: "border-amber-200", text: "text-amber-500" },
  info: { title: "Info", color: "bg-blue-500", border: "border-blue-200", text: "text-blue-500" },
};

const autoOptions: Array<{ label: string; value: string }> = [
  { label: "Off", value: "off" },
  { label: "10 seconds", value: "10" },
  { label: "30 seconds", value: "30" },
  { label: "60 seconds", value: "60" },
];

const typeOptions: Array<{ label: string; value: "app" | "error" }> = [
  { label: "Application", value: "app" },
  { label: "Errors", value: "error" },
];

const formatBytes = (value: number) => {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const size = value / 1024 ** index;
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
};

const formatTimestamp = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleString()} (${date.toISOString()})`;
};

const buildSearchParams = (type: string, levels: string[], search: string, since: string, limit: number) => {
  const params = new URLSearchParams();
  params.set("type", type);
  params.set("limit", String(limit));
  if (levels.length) params.set("levels", levels.join(","));
  if (search.trim()) params.set("search", search.trim());
  if (since) {
    const date = new Date(since);
    if (!Number.isNaN(date.getTime())) params.set("since", date.toISOString());
  }
  return params;
};

const parseFilename = (value: string | null) => {
  if (!value) return `logs-${Date.now()}.log`;
  const match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (match) return decodeURIComponent(match[1]);
  const simple = value.match(/filename="?([^";]+)"?/i);
  if (simple) return simple[1];
  return `logs-${Date.now()}.log`;
};

interface LogEntry {
  timestamp: string | null;
  level: string;
  message: string;
  context?: Record<string, any>;
  raw: Record<string, any>;
}

interface LogResponse {
  success?: boolean;
  data?: {
    entries: LogEntry[];
    hasMore: boolean;
    fileSize: number;
    updatedAt: string | null;
    file: string;
  };
}

export default function LogViewer() {
  const [type, setType] = useState<"app" | "error">(() => {
    // Always use 'error' type for error-only logging
    return "error";
  });
  const [selectedLevels, setSelectedLevels] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return { error: true, warn: false, info: false };
    try {
      const stored = localStorage.getItem("log_viewer_levels");
      return stored ? JSON.parse(stored) : { error: true, warn: false, info: false };
    } catch {
      return { error: true, warn: false, info: false };
    }
  });
  const [autoRefresh, setAutoRefresh] = useState<string>(() => {
    if (typeof window === "undefined") return "10";
    return localStorage.getItem("log_viewer_auto_refresh") || "10";
  });
  const [search, setSearch] = useState("");
  const [since, setSince] = useState("");
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [meta, setMeta] = useState<{ updatedAt: string | null; fileSize: number; hasMore: boolean; file: string | null }>({
    updatedAt: null,
    fileSize: 0,
    hasMore: false,
    file: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<number>>(new Set());
  const [deleteMode, setDeleteMode] = useState(false);

  const activeLevels = useMemo(
    () => Object.entries(selectedLevels).filter(([, value]) => value).map(([key]) => key),
    [selectedLevels]
  );

  const loadLogs = useCallback(
    async (silent = false) => {
      if (!activeLevels.length) {
        setEntries([]);
        return;
      }
      if (!silent) setLoading(true);
      try {
        const params = buildSearchParams(type, activeLevels, search, since, 200);
        const response = await api<LogResponse>(`/logs?${params.toString()}`);
        const payload = response?.data || (response as any);
        setEntries(payload.entries || []);
        setMeta({
          updatedAt: payload.updatedAt || null,
          fileSize: payload.fileSize || 0,
          hasMore: Boolean(payload.hasMore),
          file: payload.file || null,
        });
        setError(null);
      } catch (err: any) {
        const message = err?.message || "Failed to load logs";
        setError(message);
        toast.error(message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [activeLevels, search, since, type]
  );

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    if (autoRefresh === "off") return;
    const ms = Number(autoRefresh) * 1000;
    if (!Number.isFinite(ms) || ms <= 0) return;
    const id = setInterval(() => {
      void loadLogs(true);
    }, ms);
    return () => clearInterval(id);
  }, [autoRefresh, loadLogs]);

  const toggleLevel = (level: string) => {
    setSelectedLevels((prev) => {
      const updated = { ...prev, [level]: !prev[level] };
      if (typeof window !== "undefined") {
        localStorage.setItem("log_viewer_levels", JSON.stringify(updated));
      }
      return updated;
    });
  };

  const resetFilters = () => {
    const defaults = { error: true, warn: false, info: false };
    setSelectedLevels(defaults);
    if (typeof window !== "undefined") {
      localStorage.setItem("log_viewer_levels", JSON.stringify(defaults));
    }
    setSearch("");
    setSince("");
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("log_viewer_type", type);
    }
  }, [type]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("log_viewer_auto_refresh", autoRefresh);
    }
  }, [autoRefresh]);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const deleteSelected = async () => {
    if (selectedForDelete.size === 0) {
      toast.error("No entries selected for deletion");
      return;
    }
    try {
      const indices = Array.from(selectedForDelete);
      
      // For error type, use IDs; for app type, use timestamps
      if (type === 'error') {
        const ids = indices.map((i) => entries[i]?.raw?.id).filter(Boolean);
        if (ids.length === 0) {
          toast.error("No valid entries to delete");
          return;
        }
        await api("/logs/delete", {
          method: "POST",
          body: JSON.stringify({ type, ids }),
        });
        toast.success(`Deleted ${ids.length} error log entries`);
      } else {
        const timestamps = indices.map((i) => entries[i]?.timestamp).filter(Boolean);
        if (timestamps.length === 0) {
          toast.error("No valid entries to delete");
          return;
        }
        await api("/logs/delete", {
          method: "POST",
          body: JSON.stringify({ type, timestamps }),
        });
        toast.success(`Deleted ${timestamps.length} log entries`);
      }
      
      setSelectedForDelete(new Set());
      setDeleteMode(false);
      void loadLogs();
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete logs");
    }
  };

  const toggleDeleteSelection = (index: number) => {
    setSelectedForDelete((prev) => {
      const updated = new Set(prev);
      if (updated.has(index)) updated.delete(index);
      else updated.add(index);
      return updated;
    });
  };

  const selectAllForDelete = () => {
    if (selectedForDelete.size === entries.length) {
      setSelectedForDelete(new Set());
    } else {
      setSelectedForDelete(new Set(entries.map((_, i) => i)));
    }
  };

  const download = async () => {
    try {
      const params = buildSearchParams(type, activeLevels, search, since, 200);
      const token = typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;
      const res = await fetch(`${apiBase}/logs/download?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = parseFilename(res.headers.get("content-disposition"));
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Logs downloaded");
    } catch (err: any) {
      toast.error(err?.message || "Failed to download logs");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Log Observatory</h1>
        <p className="text-muted-foreground">Monitor production signals without touching the terminal.</p>
      </div>
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
            {/* Stream selector hidden - always use error type */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Auto refresh</label>
              <Select value={autoRefresh} onValueChange={setAutoRefresh}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {autoOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Since</label>
              <Input
                type="datetime-local"
                value={since}
                onChange={(event) => setSince(event.target.value)}
              />
            </div>
            <div className="md:col-span-2 lg:col-span-3 space-y-2">
              <label className="text-sm font-medium">Search</label>
              <div className="relative">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Keyword, request id, user id..."
                  className="pl-10"
                />
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Level filters hidden - only errors shown */}
            <div className="flex items-center gap-2">
              <Badge className="text-red-500 bg-muted">Showing: Errors Only</Badge>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" onClick={() => loadLogs()} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button variant="outline" onClick={resetFilters}>
                Clear
              </Button>
              <Button onClick={download}>
                <FileDown className="h-4 w-4 mr-2" />
                Download
              </Button>
              <Button
                variant={deleteMode ? "destructive" : "outline"}
                onClick={() => {
                  setDeleteMode(!deleteMode);
                  setSelectedForDelete(new Set());
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {deleteMode ? "Cancel" : "Delete"}
              </Button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Last update</div>
              <div className="mt-1 text-sm font-medium">{meta.updatedAt ? new Date(meta.updatedAt).toLocaleString() : "—"}</div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">File size</div>
              <div className="mt-1 text-sm font-medium">{formatBytes(meta.fileSize)}</div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">More available</div>
              <div className="mt-1 text-sm font-medium">{meta.hasMore ? "Yes" : "No"}</div>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Latest entries</CardTitle>
            <p className="text-sm text-muted-foreground">Newest first, filtered by your preferences.</p>
          </div>
          <div className="flex items-center gap-2">
            {deleteMode && selectedForDelete.size > 0 && (
              <Button size="sm" variant="destructive" onClick={deleteSelected}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete {selectedForDelete.size} selected
              </Button>
            )}
            {loading && <Badge variant="secondary">Updating…</Badge>}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
              <ServerCrash className="h-10 w-10" />
              <p>{error}</p>
              <Button variant="outline" onClick={() => loadLogs()}>
                Try again
              </Button>
            </div>
          ) : entries.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">No log entries match the selected filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="table-fixed w-full">
                <TableHeader>
                  <TableRow>
                    {deleteMode && (
                      <TableHead className="w-[50px]">
                        <input
                          type="checkbox"
                          checked={selectedForDelete.size === entries.length && entries.length > 0}
                          onChange={selectAllForDelete}
                          className="h-4 w-4 cursor-pointer"
                        />
                      </TableHead>
                    )}
                    <TableHead className="w-[110px]">Level</TableHead>
                    <TableHead className="min-w-[300px] max-w-[500px]">Message</TableHead>
                    <TableHead className="w-[180px]">Timestamp</TableHead>
                    <TableHead className="w-[180px] sticky right-0 bg-background">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry, index) => (
                    <TableRow key={`${entry.timestamp || index}-${entry.message.slice(0, 32)}`}>
                      {deleteMode && (
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedForDelete.has(index)}
                            onChange={() => toggleDeleteSelection(index)}
                            className="h-4 w-4 cursor-pointer"
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge className={`${levelLabels[entry.level]?.text || ""} bg-muted`}>{levelLabels[entry.level]?.title || entry.level}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium leading-relaxed max-w-[500px] truncate" title={entry.message}>
                          {entry.message || "(no message)"}
                        </div>
                        <div className="text-xs text-muted-foreground truncate max-w-[500px]">
                          {entry.raw?.trace_id || entry.raw?.traceId || entry.raw?.context?.traceId || ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {entry.timestamp ? (
                          <div>
                            <div className="text-xs">{new Date(entry.timestamp).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="sticky right-0 bg-background">
                        <div className="flex gap-2 items-center justify-end">
                          <Button size="sm" variant="outline" onClick={() => setSelected(entry)}>
                            Inspect
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const fullEntry = JSON.stringify({
                                timestamp: entry.timestamp,
                                level: entry.level,
                                message: entry.message,
                                ...entry.raw
                              }, null, 2);
                              copyToClipboard(fullEntry, "Full entry");
                            }}
                            title="Copy full entry with payload"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
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
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Log entry</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground uppercase">Level</div>
                  <div className="text-sm font-medium">{selected.level}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase">Timestamp</div>
                  <div className="text-sm font-medium">{formatTimestamp(selected.timestamp)}</div>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs text-muted-foreground uppercase">Message</div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copyToClipboard(selected.message, "Message")}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Copy
                  </Button>
                </div>
                <div className="mt-1 rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">
                  {selected.message}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs text-muted-foreground uppercase">Payload</div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copyToClipboard(JSON.stringify(selected.raw, null, 2), "Payload")}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Copy
                  </Button>
                </div>
                <pre className="mt-2 max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-sm">
                  {JSON.stringify(selected.raw, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}