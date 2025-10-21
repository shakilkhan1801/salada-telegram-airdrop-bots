import React, { useEffect, useMemo, useState } from 'react';
import { Database as DbIcon, RefreshCw, FileText, Eye, Settings, Trash2, PlusCircle, Wrench, Download, Server, HardDrive, Activity, Clock, Key, Search, AlertTriangle, ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { toast } from 'sonner';
import { DocumentViewer } from './DocumentViewer';

const apiBase =
  (import.meta.env.VITE_API_BASE as string) ||
  (typeof window !== 'undefined' ? `${window.location.origin}/api/admin` : '/api/admin');

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${apiBase}${path}`, {
    headers,
    credentials: 'include',
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function parseJsonSafe(text: string, field: string) {
  if (text === '' || text === undefined || text === null) return undefined;
  try { return JSON.parse(text); } catch {
    throw new Error(`${field} must be valid JSON`);
  }
}

function stringifyCell(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v && typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

export default function DatabaseSimpleView() {
  const [dbs, setDbs] = useState<string[]>([]);
  const [dbName, setDbName] = useState<string>('');
  const [collections, setCollections] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [mongoStats, setMongoStats] = useState<any>(null);
  const [redisStats, setRedisStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [selectedCollection, setSelectedCollection] = useState<string>('');

  // Query Dialog state (advanced)
  const [queryOpen, setQueryOpen] = useState(false);
  const [queryResults, setQueryResults] = useState<any[]>([]);
  const [queryTotal, setQueryTotal] = useState<number>(0);
  const [filter, setFilter] = useState<string>('{}');
  const [projection, setProjection] = useState<string>('');
  const [sort, setSort] = useState<string>('');
  const [limit, setLimit] = useState<string>('20');
  const [skip, setSkip] = useState<string>('0');

  // Inline Explorer state (click collection shows docs like MongoDB)
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [explorerFilter, setExplorerFilter] = useState<string>('{}');
  const [explorerProjection, setExplorerProjection] = useState<string>('');
  const [explorerSort, setExplorerSort] = useState<string>('{"_id": -1}');
  const [explorerLimit, setExplorerLimit] = useState<string>('50');
  const [explorerSkip, setExplorerSkip] = useState<string>('0');
  const [explorerDocs, setExplorerDocs] = useState<any[]>([]);
  const [explorerTotal, setExplorerTotal] = useState<number>(0);
  const [docViewOpen, setDocViewOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<any | null>(null);
  
  // Database selection
  const [selectedDb, setSelectedDb] = useState<'mongodb' | 'redis'>('mongodb');
  
  // Redis Explorer state
  const [redisGroups, setRedisGroups] = useState<any[]>([]);
  const [redisIndividuals, setRedisIndividuals] = useState<any[]>([]);
  const [redisTotal, setRedisTotal] = useState(0);
  const [redisLoading, setRedisLoading] = useState(false);
  const [redisPattern, setRedisPattern] = useState('*');
  const [redisSearchInput, setRedisSearchInput] = useState('*');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedRedisKey, setSelectedRedisKey] = useState<any>(null);
  const [redisKeyViewOpen, setRedisKeyViewOpen] = useState(false);
  const [redisDeleteOpen, setRedisDeleteOpen] = useState(false);
  const [redisKeysToDelete, setRedisKeysToDelete] = useState<string[]>([]);
  const [redisFlushOpen, setRedisFlushOpen] = useState(false);
  const [redisFlushConfirm, setRedisFlushConfirm] = useState('');

  // Insert / Update / Delete Dialogs
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertDoc, setInsertDoc] = useState<string>('{}');

  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateFilter, setUpdateFilter] = useState<string>('{"_id":"<id or criteria>"}');
  const [updateDoc, setUpdateDoc] = useState<string>('{}');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteFilter, setDeleteFilter] = useState<string>('{}');

  // Indexes Dialog
  const [indexesOpen, setIndexesOpen] = useState(false);
  const [indexes, setIndexes] = useState<any[]>([]);
  const [indexKeys, setIndexKeys] = useState<string>('{}');
  const [indexOptions, setIndexOptions] = useState<string>('{}');

  // Export
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');

  // Drop collection / DB
  const [droppingCollection, setDroppingCollection] = useState<string>('');
  const [dropConfirm, setDropConfirm] = useState<string>('');
  const [dangerOpen, setDangerOpen] = useState(false);
  const [dropDbConfirm, setDropDbConfirm] = useState<string>('');
  const [recreateDbConfirm, setRecreateDbConfirm] = useState<string>('');

  useEffect(() => { void loadDatabases(); void loadDbStats(); }, []);
  useEffect(() => { if (dbName) void fetchCollections(); }, [dbName]);

  async function loadDatabases() {
    setLoading(true);
    try {
      const resp = await api<any>('/db/databases');
      const names = (resp?.data || []) as string[];
      setDbs(names);
      const chosen = names[0] || '';
      setDbName(chosen);
    } catch {
      toast.error('Failed to load databases');
    } finally { setLoading(false); }
  }

  async function loadDbStats() {
    setStatsLoading(true);
    try {
      const [mongoResp, redisResp] = await Promise.all([
        api<any>('/db/mongodb-stats').catch(() => null),
        api<any>('/db/redis-stats').catch(() => null)
      ]);
      setMongoStats(mongoResp?.data || null);
      setRedisStats(redisResp?.data || null);
    } catch {
      toast.error('Failed to load database stats');
    } finally { setStatsLoading(false); }
  }

  async function fetchCollections() {
    setLoading(true);
    try {
      const resp = await api<any>(`/db/collections?db=${encodeURIComponent(dbName)}`);
      setCollections(resp?.data || []);
    } catch { toast.error('Failed to load collections'); }
    finally { setLoading(false); }
  }

  async function runQuery() {
    if (!selectedCollection) return;
    setLoading(true);
    try {
      const body: any = {
        db: dbName,
        collection: selectedCollection,
        filter: parseJsonSafe(filter || '{}', 'Filter') || {},
        limit: Number(limit || '20') || 20,
        skip: Number(skip || '0') || 0,
      };
      const proj = parseJsonSafe(projection || '', 'Projection'); if (proj) body.projection = proj;
      const srt = parseJsonSafe(sort || '', 'Sort'); if (srt) body.sort = srt;
      const resp = await api<any>('/db/query', { method: 'POST', body: JSON.stringify(body) });
      setQueryResults(resp?.data || []);
      setQueryTotal(resp?.total || (resp?.data?.length || 0));
      toast.success(`Found ${resp?.data?.length || 0} documents`);
    } catch (e: any) { toast.error(e?.message || 'Query failed'); }
    finally { setLoading(false); }
  }

  async function openIndexes(col: string) {
    setSelectedCollection(col); setIndexesOpen(true);
    try { const resp = await api<any>(`/db/indexes?db=${encodeURIComponent(dbName)}&collection=${encodeURIComponent(col)}`); setIndexes(resp?.data || []); }
    catch { setIndexes([]); }
  }

  async function createIndex() {
    try {
      const keys = parseJsonSafe(indexKeys, 'Keys');
      const options = parseJsonSafe(indexOptions || '{}', 'Options') || {};
      if (!keys || typeof keys !== 'object') { toast.error('Keys required'); return; }
      const resp = await api<any>('/db/indexes/create', { method: 'POST', body: JSON.stringify({ db: dbName, collection: selectedCollection, keys, options }) });
      toast.success(`Index created: ${resp?.name || 'ok'}`);
      await openIndexes(selectedCollection);
    } catch (e: any) { toast.error(e?.message || 'Create index failed'); }
  }

  async function dropIndex(name: string) {
    try { await api<any>('/db/indexes/drop', { method: 'POST', body: JSON.stringify({ db: dbName, collection: selectedCollection, name }) }); toast.success('Index dropped'); await openIndexes(selectedCollection); }
    catch (e: any) { toast.error(e?.message || 'Drop index failed'); }
  }

  async function doInsertOne() {
    try {
      const doc = parseJsonSafe(insertDoc, 'Document');
      if (!doc || typeof doc !== 'object') { toast.error('Document must be an object'); return; }
      await api<any>('/db/insert-one', { method: 'POST', body: JSON.stringify({ db: dbName, collection: selectedCollection, doc }) });
      toast.success('Inserted'); setInsertOpen(false);
      if (explorerOpen) await runExplorer(); else await runQuery(); await fetchCollections();
    } catch (e: any) { toast.error(e?.message || 'Insert failed'); }
  }

  async function doUpdateOne() {
    try {
      const filterObj = parseJsonSafe(updateFilter || '{}', 'Filter') || {};
      const updateObj = parseJsonSafe(updateDoc || '{}', 'Update') || {};
      await api<any>('/db/update-one', { method: 'POST', body: JSON.stringify({ db: dbName, collection: selectedCollection, filter: filterObj, update: updateObj }) });
      toast.success('Updated'); setUpdateOpen(false);
      if (explorerOpen) await runExplorer(); else await runQuery();
    } catch (e: any) { toast.error(e?.message || 'Update failed'); }
  }

  async function doDeleteMany() {
    try {
      const filterObj = parseJsonSafe(deleteFilter || '{}', 'Filter') || {};
      const resp = await api<any>('/db/delete-many', { method: 'POST', body: JSON.stringify({ db: dbName, collection: selectedCollection, filter: filterObj }) });
      toast.success(`Deleted ${resp?.deleted || 0}`); setDeleteOpen(false);
      if (explorerOpen) await runExplorer(); else await runQuery(); await fetchCollections();
    } catch (e: any) { toast.error(e?.message || 'Delete failed'); }
  }

  async function exportCollection(col: string) {
    setExporting(true);
    try {
      const qs = new URLSearchParams();
      qs.set('db', dbName); qs.set('collection', col); qs.set('format', exportFormat);
      if (explorerOpen) {
        if (explorerFilter) qs.set('filter', explorerFilter);
        if (explorerProjection) qs.set('projection', explorerProjection);
        if (explorerSort) qs.set('sort', explorerSort);
        if (explorerLimit) qs.set('limit', explorerLimit);
      } else {
        if (filter) qs.set('filter', filter);
        if (projection) qs.set('projection', projection);
        if (sort) qs.set('sort', sort);
        if (limit) qs.set('limit', limit);
      }
      const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
      const res = await fetch(`${apiBase}/db/export?${qs.toString()}`, { credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (!res.ok) throw new Error('Export failed');
      const ct = res.headers.get('content-type') || '';
      const disposition = res.headers.get('content-disposition') || '';
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch ? filenameMatch[1] : `${col}.${exportFormat}`;
      const data = await res.text();
      const blob = new Blob([data], { type: ct || (exportFormat === 'csv' ? 'text/csv' : 'application/json') });
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
      toast.success('Export completed');
    } catch (e: any) { toast.error(e?.message || 'Export failed'); }
    finally { setExporting(false); }
  }

  async function dropCollection(col: string) { setSelectedCollection(col); setDroppingCollection(col); }

  async function confirmDropCollection() {
    if (dropConfirm !== selectedCollection) { toast.error('Type the collection name to confirm'); return; }
    try { await api<any>('/db/drop-collection', { method: 'POST', body: JSON.stringify({ db: dbName, collection: selectedCollection, confirm: dropConfirm }) }); toast.success('Collection dropped'); setDroppingCollection(''); setDropConfirm(''); await fetchCollections(); setExplorerOpen(false); }
    catch (e: any) { toast.error(e?.message || 'Drop collection failed'); }
  }

  async function confirmDropDatabase() {
    const expected = `drop ${dbName}`;
    if (dropDbConfirm !== expected) { toast.error(`Type '${expected}' to confirm`); return; }
    try { await api<any>('/db/drop-database', { method: 'POST', body: JSON.stringify({ db: dbName, confirm: dropDbConfirm }) }); toast.success('Database dropped'); setDangerOpen(false); setDropDbConfirm(''); await loadDatabases(); setExplorerOpen(false); }
    catch (e: any) { toast.error(e?.message || 'Drop database failed'); }
  }

  async function confirmRecreateDatabase() {
    const expected = `recreate ${dbName}`;
    if (recreateDbConfirm !== expected) { toast.error(`Type '${expected}' to confirm`); return; }
    try { await api<any>('/db/recreate', { method: 'POST', body: JSON.stringify({ db: dbName, confirm: recreateDbConfirm }) }); toast.success('Database recreated'); setDangerOpen(false); setRecreateDbConfirm(''); await loadDatabases(); setExplorerOpen(false); }
    catch (e: any) { toast.error(e?.message || 'Recreate database failed'); }
  }

  async function runExplorer() {
    if (!selectedCollection) return;
    setLoading(true);
    try {
      const body: any = {
        db: dbName,
        collection: selectedCollection,
        filter: parseJsonSafe(explorerFilter || '{}', 'Filter') || {},
        limit: Number(explorerLimit || '50') || 50,
        skip: Number(explorerSkip || '0') || 0,
      };
      const proj = parseJsonSafe(explorerProjection || '', 'Projection'); if (proj) body.projection = proj;
      const srt = parseJsonSafe(explorerSort || '', 'Sort'); if (srt) body.sort = srt; else body.sort = { _id: -1 };
      const resp = await api<any>('/db/query', { method: 'POST', body: JSON.stringify(body) });
      setExplorerDocs(resp?.data || []);
      setExplorerTotal(resp?.total || (resp?.data?.length || 0));
    } catch (e: any) { toast.error(e?.message || 'Load documents failed'); }
    finally { setLoading(false); }
  }

  function onSelectCollection(col: string) {
    setSelectedCollection(col);
    setExplorerOpen(true);
    setExplorerFilter('{}'); setExplorerProjection(''); setExplorerSort('{"_id": -1}'); setExplorerLimit('50'); setExplorerSkip('0');
    void runExplorer();
  }

  const explorerColumns = useMemo(() => {
    const keys = new Set<string>();
    const priority = ['_id','userId','telegramId','username','taskId','status','createdAt','updatedAt'];
    for (const k of priority) keys.add(k);
    for (const d of explorerDocs) {
      Object.keys(d || {}).forEach((k) => keys.add(k));
    }
    const arr = Array.from(keys);
    return arr.slice(0, 12);
  }, [explorerDocs]);

  async function deleteOneById(doc: any) {
    try {
      const id = doc?._id;
      if (!id) { toast.error('No _id present'); return; }
      await api<any>('/db/delete-one', { method: 'POST', body: JSON.stringify({ db: dbName, collection: selectedCollection, filter: { _id: typeof id === 'string' ? id : (id?.$oid || id) } }) });
      toast.success('Document deleted');
      await runExplorer();
      await fetchCollections();
    } catch (e: any) { toast.error(e?.message || 'Delete failed'); }
  }

  function openDocView(doc: any) { setSelectedDoc(doc); setDocViewOpen(true); }

  function formatBytes(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatUptime(seconds: number) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  function getTypeColor(type: string) {
    const colors: Record<string, string> = {
      string: 'bg-blue-100 text-blue-800',
      hash: 'bg-green-100 text-green-800',
      list: 'bg-yellow-100 text-yellow-800',
      set: 'bg-purple-100 text-purple-800',
      zset: 'bg-pink-100 text-pink-800',
      stream: 'bg-indigo-100 text-indigo-800'
    };
    return colors[type] || 'bg-gray-100 text-gray-800';
  }

  async function loadRedisKeys() {
    setRedisLoading(true);
    try {
      const resp = await api<any>(`/db/redis-keys?pattern=${encodeURIComponent(redisPattern)}&limit=1000`);
      
      setRedisGroups(resp?.data?.groups || []);
      setRedisIndividuals(resp?.data?.individuals || []);
      setRedisTotal(resp?.data?.total || 0);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load Redis keys');
    } finally {
      setRedisLoading(false);
    }
  }

  async function handleRedisSearch() {
    setRedisPattern(redisSearchInput);
    void loadRedisKeys();
  }

  function toggleGroup(prefix: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(prefix)) {
        next.delete(prefix);
      } else {
        next.add(prefix);
      }
      return next;
    });
  }

  async function viewRedisKey(keyName: string) {
    try {
      const resp = await api<any>(`/db/redis-get?key=${encodeURIComponent(keyName)}`);
      setSelectedRedisKey(resp?.data || null);
      setRedisKeyViewOpen(true);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to get key value');
    }
  }

  async function deleteRedisKeys() {
    if (redisKeysToDelete.length === 0) return;
    
    try {
      await api<any>('/db/redis-delete', {
        method: 'POST',
        body: JSON.stringify({ keys: redisKeysToDelete })
      });
      
      toast.success(`Deleted ${redisKeysToDelete.length} key(s)`);
      setRedisDeleteOpen(false);
      setRedisKeysToDelete([]);
      void loadRedisKeys();
      void loadDbStats();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete keys');
    }
  }

  async function flushRedisDatabase() {
    if (redisFlushConfirm !== 'FLUSH REDIS') {
      toast.error('Type "FLUSH REDIS" to confirm');
      return;
    }
    
    try {
      await api<any>('/db/redis-flush', {
        method: 'POST',
        body: JSON.stringify({ confirm: redisFlushConfirm })
      });
      
      toast.success('Redis database flushed');
      setRedisFlushOpen(false);
      setRedisFlushConfirm('');
      void loadRedisKeys();
      void loadDbStats();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to flush Redis');
    }
  }

  function selectMongoDb() {
    setSelectedDb('mongodb');
    setExplorerOpen(false);
  }

  function selectRedisDb() {
    setSelectedDb('redis');
    setExplorerOpen(false);
    void loadRedisKeys();
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DbIcon className="h-5 w-5" />
          <h2 className="text-3xl font-bold tracking-tight">Database</h2>
          {selectedDb === 'mongodb' && (
            <div className="flex items-center gap-2">
              <Label className="text-sm">DB</Label>
              <Select value={dbName} onValueChange={(v)=>{ setDbName(v); setExplorerOpen(false); }}>
                <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select database" /></SelectTrigger>
                <SelectContent>
                  {dbs.map(d => (<SelectItem key={d} value={d}>{d}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedDb === 'mongodb' ? (
            <>
              <Button variant="outline" onClick={() => { void fetchCollections(); void loadDbStats(); }} disabled={loading}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
              <Button variant="destructive" onClick={() => { setDangerOpen(true); setDropDbConfirm(''); }}><Trash2 className="h-4 w-4 mr-2" /> Delete DB</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => { void loadRedisKeys(); void loadDbStats(); }} disabled={redisLoading}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
              <Button variant="destructive" onClick={() => setRedisFlushOpen(true)}><Trash2 className="h-4 w-4 mr-2" /> Flush All Keys</Button>
            </>
          )}
        </div>
      </div>

      {/* Database Overview Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* MongoDB Card */}
        <Card 
          className={`rounded-2xl border bg-gradient-to-br from-green-50 to-white dark:from-green-950/20 dark:to-background cursor-pointer hover:shadow-lg transition-all ${selectedDb === 'mongodb' ? 'ring-2 ring-green-500' : ''}`}
          onClick={selectMongoDb}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900/50 flex items-center justify-center">
                <DbIcon className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <CardTitle className="text-lg">MongoDB</CardTitle>
                <p className="text-xs text-muted-foreground">{mongoStats?.database || dbName}</p>
              </div>
            </div>
            {mongoStats?.status === 'connected' && (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0">
                <Activity className="h-3 w-3 mr-1" /> {selectedDb === 'mongodb' ? 'Selected' : 'Connected'}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {statsLoading ? (
              <div className="text-sm text-muted-foreground">Loading stats...</div>
            ) : mongoStats ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Collections</div>
                    <div className="text-2xl font-bold">{mongoStats.collections || 0}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Documents</div>
                    <div className="text-2xl font-bold">{(mongoStats.objects || 0).toLocaleString()}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Data Size</div>
                    <div className="text-lg font-semibold">{formatBytes(mongoStats.dataSize || 0)}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Storage Size</div>
                    <div className="text-lg font-semibold">{formatBytes(mongoStats.storageSize || 0)}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Index Size</div>
                    <div className="text-lg font-semibold">{formatBytes(mongoStats.indexSize || 0)}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Indexes</div>
                    <div className="text-lg font-semibold">{mongoStats.indexes || 0}</div>
                  </div>
                </div>
                <div className="pt-2 border-t flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>Uptime: {formatUptime(mongoStats.uptime || 0)}</span>
                  </div>
                  <div className="text-muted-foreground">
                    v{mongoStats.version || 'unknown'}
                  </div>
                </div>
                <div className="pt-1 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-muted-foreground">Connections</span>
                    <span className="font-medium">{mongoStats.connections?.current || 0} / {mongoStats.connections?.available || 0}</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-1.5">
                    <div 
                      className="bg-green-600 h-1.5 rounded-full transition-all" 
                      style={{ width: `${Math.min(100, ((mongoStats.connections?.current || 0) / (mongoStats.connections?.available || 1) * 100))}%` }}
                    ></div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No stats available</div>
            )}
          </CardContent>
        </Card>

        {/* Redis Card */}
        <Card 
          className={`rounded-2xl border bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-background cursor-pointer hover:shadow-lg transition-all ${selectedDb === 'redis' ? 'ring-2 ring-red-500' : ''}`}
          onClick={() => redisStats?.status === 'connected' && selectRedisDb()}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-lg bg-red-100 dark:bg-red-900/50 flex items-center justify-center">
                <Server className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <div>
                  <CardTitle className="text-lg">Redis</CardTitle>
                  <p className="text-xs text-muted-foreground">Cache & Session Store</p>
                </div>
                {redisStats?.status === 'connected' && (
                  <Badge variant="outline" className="text-xs">Click to browse</Badge>
                )}
              </div>
            </div>
            {redisStats?.status === 'connected' && (
              <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-0">
                <Activity className="h-3 w-3 mr-1" /> {selectedDb === 'redis' ? 'Selected' : 'Connected'}
              </Badge>
            )}
            {redisStats?.status === 'not_configured' && (
              <Badge variant="outline" className="text-muted-foreground">Not Configured</Badge>
            )}
            {redisStats?.status === 'disconnected' && (
              <Badge variant="destructive">Disconnected</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {statsLoading ? (
              <div className="text-sm text-muted-foreground">Loading stats...</div>
            ) : redisStats?.status === 'connected' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Total Keys</div>
                    <div className="text-2xl font-bold">{(redisStats.keys || 0).toLocaleString()}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Connected Clients</div>
                    <div className="text-2xl font-bold">{redisStats.clients?.connected || 0}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Memory Used</div>
                    <div className="text-lg font-semibold">{redisStats.memory?.usedHuman || '0B'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Memory Peak</div>
                    <div className="text-lg font-semibold">{redisStats.memory?.peakHuman || '0B'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Memory Limit</div>
                    <div className="text-lg font-semibold">{redisStats.memory?.maxHuman || 'unlimited'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Ops/sec</div>
                    <div className="text-lg font-semibold">{(redisStats.ops?.instantaneous || 0).toLocaleString()}</div>
                  </div>
                </div>
                <div className="pt-2 border-t flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>Uptime: {formatUptime(redisStats.uptime || 0)}</span>
                  </div>
                  <div className="text-muted-foreground">
                    v{redisStats.version || 'unknown'}
                  </div>
                </div>
                {redisStats.memory?.maxHuman !== 'unlimited' && (
                  <div className="pt-1 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-muted-foreground">Memory Usage</span>
                      <span className="font-medium">{redisStats.memory?.usagePercent}%</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-1.5">
                      <div 
                        className="bg-red-600 h-1.5 rounded-full transition-all" 
                        style={{ width: `${Math.min(100, parseFloat(redisStats.memory?.usagePercent || '0'))}%` }}
                      ></div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                {redisStats?.message || 'Redis stats not available'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* MongoDB Collections or Redis Keys */}
      {selectedDb === 'mongodb' ? (
        <>
      {/* Collections */}
      <Card className="rounded-2xl border bg-card/95">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Collections</CardTitle>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Export format</Label>
              <Select value={exportFormat} onValueChange={(v:any)=>setExportFormat(v)}>
                <SelectTrigger className="w-[120px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">csv</SelectItem>
                  <SelectItem value="json">json</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Collection</TableHead>
                  <TableHead className="text-right">Documents</TableHead>
                  <TableHead className="w-[360px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {collections.map((c) => (
                  <TableRow key={c.name} onClick={() => onSelectCollection(c.name)} className="cursor-pointer hover:bg-muted/40">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{c.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{c.count?.toLocaleString() || '0'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2" onClick={(e)=>e.stopPropagation()}>
                        <Button size="sm" variant="outline" onClick={() => { setSelectedCollection(c.name); setQueryOpen(true); }}>
                          <Eye className="h-3 w-3 mr-1" /> View / Query
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setSelectedCollection(c.name); setInsertOpen(true); }}>
                          <PlusCircle className="h-3 w-3 mr-1" /> Insert One
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void openIndexes(c.name)}>
                          <Settings className="h-3 w-3 mr-1" /> Indexes
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setSelectedCollection(c.name); void exportCollection(c.name); }} disabled={exporting}>
                          <Download className="h-3 w-3 mr-1" /> {exporting ? 'Exporting...' : 'Export'}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => { setSelectedCollection(c.name); setDropConfirm(''); void dropCollection(c.name); }}>
                          <Trash2 className="h-3 w-3 mr-1" /> Drop
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {collections.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No collections found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Inline Explorer */}
      {explorerOpen && selectedCollection && (
        <Card className="rounded-2xl border bg-card/95">
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <CardTitle>Documents — {selectedCollection} <span className="text-xs text-muted-foreground">({explorerDocs.length} of {explorerTotal})</span></CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => void runExplorer()} disabled={loading}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
              <Button variant="outline" onClick={() => { setExplorerSkip(String(Math.max(0, Number(explorerSkip||'0') - Number(explorerLimit||'50')))); void runExplorer(); }}>Prev</Button>
              <Button variant="outline" onClick={() => { setExplorerSkip(String(Number(explorerSkip||'0') + Number(explorerLimit||'50'))); void runExplorer(); }}>Next</Button>
              <Button variant="outline" onClick={() => void exportCollection(selectedCollection)} disabled={exporting}><Download className="h-4 w-4 mr-2" />Export</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label>Filter (JSON)</Label>
                <Textarea rows={3} value={explorerFilter} onChange={(e)=>setExplorerFilter(e.target.value)} className="font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label>Projection (JSON)</Label>
                <Textarea rows={3} value={explorerProjection} onChange={(e)=>setExplorerProjection(e.target.value)} placeholder='{"field":1}' className="font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label>Sort (JSON)</Label>
                <Input value={explorerSort} onChange={(e)=>setExplorerSort(e.target.value)} placeholder='{"createdAt":-1}' className="font-mono text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Limit</Label>
                  <Input type="number" value={explorerLimit} onChange={(e)=>setExplorerLimit(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Skip</Label>
                  <Input type="number" value={explorerSkip} onChange={(e)=>setExplorerSkip(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {explorerColumns.map((c) => (<TableHead key={c}>{c}</TableHead>))}
                    <TableHead className="w-40">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {explorerDocs.map((d, i) => (
                    <TableRow key={d._id || i}>
                      {explorerColumns.map((c) => (
                        <TableCell key={c} className="max-w-[280px] truncate" title={stringifyCell((d as any)[c])}>{stringifyCell((d as any)[c])}</TableCell>
                      ))}
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => { openDocView(d); }}><Eye className="h-3 w-3 mr-1" /> View</Button>
                          <Button size="sm" variant="destructive" onClick={() => void deleteOneById(d)}><Trash2 className="h-3 w-3 mr-1" /> Delete</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {explorerDocs.length === 0 && (
                    <TableRow><TableCell colSpan={explorerColumns.length + 1} className="text-center py-10 text-sm text-muted-foreground">No documents</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Query Dialog (advanced) */}
      <Dialog open={queryOpen} onOpenChange={setQueryOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Query: {selectedCollection}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Filter (JSON)</Label>
              <Textarea rows={4} value={filter} onChange={(e)=>setFilter(e.target.value)} className="font-mono text-xs" />
            </div>
            <div className="space-y-2">
              <Label>Projection (JSON)</Label>
              <Textarea rows={4} value={projection} onChange={(e)=>setProjection(e.target.value)} placeholder='{"field":1}' className="font-mono text-xs" />
            </div>
            <div className="space-y-2">
              <Label>Sort (JSON)</Label>
              <Input value={sort} onChange={(e)=>setSort(e.target.value)} placeholder='{"createdAt":-1}' className="font-mono text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Limit</Label>
                <Input type="number" value={limit} onChange={(e)=>setLimit(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Skip</Label>
                <Input type="number" value={skip} onChange={(e)=>setSkip(e.target.value)} />
              </div>
            </div>
            <div className="md:col-span-2 flex flex-wrap gap-2">
              <Button onClick={() => void runQuery()} disabled={loading}><Eye className="h-3 w-3 mr-1" /> Run</Button>
              <Button variant="outline" onClick={() => { setUpdateFilter(filter || '{}'); setUpdateDoc('{}'); setUpdateOpen(true); }}><Wrench className="h-3 w-3 mr-1" /> Update One</Button>
              <Button variant="destructive" onClick={() => { setDeleteFilter(filter || '{}'); setDeleteOpen(true); }}><Trash2 className="h-3 w-3 mr-1" /> Delete Many</Button>
            </div>
            {queryResults.length > 0 && (
              <div className="md:col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <Label>Results ({queryResults.length} of {queryTotal})</Label>
                </div>
                <ScrollArea className="h-[420px] border rounded p-2">
                  <pre className="text-xs">{JSON.stringify(queryResults, null, 2)}</pre>
                </ScrollArea>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQueryOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Insert Dialog */}
      <Dialog open={insertOpen} onOpenChange={setInsertOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Insert One into {selectedCollection}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Document (JSON)</Label>
            <Textarea rows={12} value={insertDoc} onChange={(e)=>setInsertDoc(e.target.value)} className="font-mono text-xs" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=>setInsertOpen(false)}>Cancel</Button>
            <Button onClick={() => void doInsertOne()}>Insert</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Dialog */}
      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Update One in {selectedCollection}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Filter (JSON)</Label>
            <Textarea rows={4} value={updateFilter} onChange={(e)=>setUpdateFilter(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="space-y-2">
            <Label>Update (JSON, fields to $set)</Label>
            <Textarea rows={8} value={updateDoc} onChange={(e)=>setUpdateDoc(e.target.value)} className="font-mono text-xs" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=>setUpdateOpen(false)}>Cancel</Button>
            <Button onClick={() => void doUpdateOne()}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Many Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Delete Many in {selectedCollection}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Filter (JSON)</Label>
            <Textarea rows={6} value={deleteFilter} onChange={(e)=>setDeleteFilter(e.target.value)} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">This will delete multiple documents. Use carefully.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=>setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void doDeleteMany()}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Indexes Dialog */}
      <Dialog open={indexesOpen} onOpenChange={setIndexesOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Indexes: {selectedCollection}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="border rounded p-2">
              <Label className="text-sm">Existing Indexes</Label>
              <ScrollArea className="h-[220px] mt-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Keys</TableHead>
                      <TableHead className="w-28">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {indexes.map((idx: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell>{idx.name}</TableCell>
                        <TableCell className="text-xs">{JSON.stringify(idx.key || {}, null, 0)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="destructive" onClick={() => void dropIndex(idx.name)}>Drop</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {indexes.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-sm text-muted-foreground text-center">No indexes</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Keys (JSON)</Label>
                <Textarea rows={6} value={indexKeys} onChange={(e)=>setIndexKeys(e.target.value)} placeholder='{"field":1}' className="font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label>Options (JSON)</Label>
                <Textarea rows={6} value={indexOptions} onChange={(e)=>setIndexOptions(e.target.value)} placeholder='{"unique":true}' className="font-mono text-xs" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void createIndex()}><Settings className="h-3 w-3 mr-1" /> Create Index</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Drop Collection Dialog */}
      <Dialog open={!!droppingCollection} onOpenChange={(o)=>{ if (!o) { setDroppingCollection(''); setDropConfirm(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Drop Collection: {selectedCollection}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Type the collection name to confirm. This action cannot be undone.</p>
            <Input value={dropConfirm} onChange={(e)=>setDropConfirm(e.target.value)} placeholder={selectedCollection} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=>{ setDroppingCollection(''); setDropConfirm(''); }}>Cancel</Button>
            <Button variant="destructive" onClick={() => void confirmDropCollection()}>Drop</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Drop / Recreate Database (Danger Zone) */}
      <Dialog open={dangerOpen} onOpenChange={setDangerOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Danger Zone — {dbName}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="border rounded p-3">
              <Label>Delete Database</Label>
              <p className="text-xs text-muted-foreground mb-2">Type 'drop {dbName}' to confirm</p>
              <Input value={dropDbConfirm} onChange={(e)=>setDropDbConfirm(e.target.value)} placeholder={`drop ${dbName}`} />
              <div className="pt-2 flex justify-end"><Button variant="destructive" onClick={() => void confirmDropDatabase()}>Delete Database</Button></div>
            </div>
            <div className="border rounded p-3">
              <Label>Recreate Database</Label>
              <p className="text-xs text-muted-foreground mb-2">Type 'recreate {dbName}' to confirm (drops and re-initializes)</p>
              <Input value={recreateDbConfirm} onChange={(e)=>setRecreateDbConfirm(e.target.value)} placeholder={`recreate ${dbName}`} />
              <div className="pt-2 flex justify-end"><Button onClick={() => void confirmRecreateDatabase()}>Recreate Database</Button></div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DocumentViewer document={selectedDoc} open={docViewOpen} onClose={() => setDocViewOpen(false)} />
      {/* MongoDB Overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="rounded-2xl border bg-card/95">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Current Database</div>
            <div className="text-lg font-semibold flex items-center gap-2"><DbIcon className="h-4 w-4" /> {dbName || '—'}</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border bg-card/95">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Collections</div>
            <div className="text-lg font-semibold">{collections.length}</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border bg-card/95">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Total Documents</div>
            <div className="text-lg font-semibold">{mongoStats?.objects?.toLocaleString() || '0'}</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border bg-card/95">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Total Size</div>
            <div className="text-lg font-semibold">{formatBytes(mongoStats?.totalSize || 0)}</div>
          </CardContent>
        </Card>
      </div>
      </>
      ) : (
        <>
      {/* Redis Keys Browser */}
      <Card className="rounded-2xl border bg-card/95">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-red-600" />
            Redis Keys
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadRedisKeys()} disabled={redisLoading}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search Bar */}
          <div className="flex gap-2">
            <div className="flex-1">
              <div className="flex gap-2">
                <Input
                  value={redisSearchInput}
                  onChange={(e) => setRedisSearchInput(e.target.value)}
                  placeholder="Search pattern: * or user:* or session:*"
                  onKeyDown={(e) => e.key === 'Enter' && handleRedisSearch()}
                />
                <Button onClick={handleRedisSearch} disabled={redisLoading}>
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Use * for wildcard (e.g., user:* for all keys starting with "user:")
              </p>
            </div>
          </div>

          {/* Keys Tree View */}
          <div className="border rounded-lg overflow-hidden">
            <ScrollArea className="h-[500px]">
              {redisLoading ? (
                <div className="text-center py-10 text-muted-foreground">Loading keys...</div>
              ) : (
                <div className="p-2">
                  {/* Grouped Keys (Tree Structure) */}
                  {redisGroups.map((group) => (
                    <div key={group.prefix} className="mb-2">
                      {/* Group Header */}
                      <div 
                        className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer group"
                        onClick={() => toggleGroup(group.prefix)}
                      >
                        {expandedGroups.has(group.prefix) ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        {expandedGroups.has(group.prefix) ? (
                          <FolderOpen className="h-4 w-4 text-amber-500" />
                        ) : (
                          <Folder className="h-4 w-4 text-amber-500" />
                        )}
                        <span className="font-medium text-sm">{group.prefix}</span>
                        <Badge variant="outline" className="ml-auto text-xs">
                          {group.percentage}%
                        </Badge>
                        <span className="text-xs text-muted-foreground">{group.count}</span>
                      </div>

                      {/* Expanded Keys */}
                      {expandedGroups.has(group.prefix) && (
                        <div className="ml-8 mt-1 space-y-1">
                          {group.keys.map((item: any) => (
                            <div key={item.key} className="flex items-center gap-2 p-2 hover:bg-muted/30 rounded text-sm group">
                              <Key className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                              <span className="font-mono text-xs flex-1 truncate" title={item.key}>
                                {item.key}
                              </span>
                              <Badge className={`${getTypeColor(item.type)} text-xs`}>
                                {item.type}
                              </Badge>
                              <span className="text-xs text-muted-foreground w-16 text-right">
                                {item.ttl}
                              </span>
                              <span className="text-xs text-muted-foreground w-16 text-right">
                                {formatBytes(item.size)}
                              </span>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0"
                                  onClick={() => viewRedisKey(item.key)}
                                >
                                  <Eye className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                                  onClick={() => {
                                    setRedisKeysToDelete([item.key]);
                                    setRedisDeleteOpen(true);
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Individual Keys (no prefix) */}
                  {redisIndividuals.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs text-muted-foreground mb-2 px-2">Individual Keys</div>
                      {redisIndividuals.map((item) => (
                        <div key={item.key} className="flex items-center gap-2 p-2 hover:bg-muted/30 rounded text-sm group">
                          <Key className="h-3 w-3 text-muted-foreground flex-shrink-0 ml-2" />
                          <span className="font-mono text-xs flex-1 truncate" title={item.key}>
                            {item.key}
                          </span>
                          <Badge className={`${getTypeColor(item.type)} text-xs`}>
                            {item.type}
                          </Badge>
                          <span className="text-xs text-muted-foreground w-16 text-right">
                            {item.ttl}
                          </span>
                          <span className="text-xs text-muted-foreground w-16 text-right">
                            {formatBytes(item.size)}
                          </span>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              onClick={() => viewRedisKey(item.key)}
                            >
                              <Eye className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                              onClick={() => {
                                setRedisKeysToDelete([item.key]);
                                setRedisDeleteOpen(true);
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* No Keys Found */}
                  {redisGroups.length === 0 && redisIndividuals.length === 0 && !redisLoading && (
                    <div className="text-center py-10 text-muted-foreground">
                      No keys found matching pattern "{redisPattern}"
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Stats */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Total: {redisTotal} key(s) | Groups: {redisGroups.length} | Individual: {redisIndividuals.length}</span>
            <span>Pattern: {redisPattern}</span>
          </div>
        </CardContent>
      </Card>

      {/* Redis Overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="rounded-2xl border bg-card/95">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Total Keys</div>
            <div className="text-lg font-semibold">{(redisStats?.keys || 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border bg-card/95">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Key Groups</div>
            <div className="text-lg font-semibold">{redisGroups.length}</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border bg-card/95">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Memory Used</div>
            <div className="text-lg font-semibold">{redisStats?.memory?.usedHuman || '0B'}</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border bg-card/95">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Connected Clients</div>
            <div className="text-lg font-semibold">{redisStats?.clients?.connected || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* View Redis Key Dialog */}
      <Dialog open={redisKeyViewOpen} onOpenChange={setRedisKeyViewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              View Redis Key
            </DialogTitle>
          </DialogHeader>
          
          {selectedRedisKey && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Key</Label>
                  <div className="font-mono text-sm bg-muted px-2 py-1 rounded mt-1 break-all">
                    {selectedRedisKey.key}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Type</Label>
                  <div className="mt-1">
                    <Badge className={getTypeColor(selectedRedisKey.type)}>
                      {selectedRedisKey.type}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">TTL</Label>
                  <div className="text-sm mt-1">{selectedRedisKey.ttl}</div>
                </div>
                <div>
                  <Label className="text-xs">Size</Label>
                  <div className="text-sm mt-1">{formatBytes(selectedRedisKey.size)}</div>
                </div>
              </div>
              
              <div>
                <Label className="text-xs">Value</Label>
                <ScrollArea className="h-[300px] mt-1 border rounded p-3 bg-muted">
                  <pre className="text-xs">
                    {typeof selectedRedisKey.value === 'object' 
                      ? JSON.stringify(selectedRedisKey.value, null, 2)
                      : String(selectedRedisKey.value || '')}
                  </pre>
                </ScrollArea>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setRedisKeyViewOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Redis Keys Confirmation Dialog */}
      <Dialog open={redisDeleteOpen} onOpenChange={setRedisDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Redis Key(s)
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete the following key(s)?
            </p>
            <div className="bg-muted p-2 rounded max-h-32 overflow-y-auto">
              {redisKeysToDelete.map(key => (
                <div key={key} className="font-mono text-xs">{key}</div>
              ))}
            </div>
            <p className="text-xs text-destructive">This action cannot be undone.</p>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setRedisDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteRedisKeys}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Flush Redis Database Dialog */}
      <Dialog open={redisFlushOpen} onOpenChange={setRedisFlushOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Flush Redis Database
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3">
            <div className="bg-destructive/10 border border-destructive/20 rounded p-3">
              <p className="text-sm font-medium text-destructive">⚠️ DANGER ZONE</p>
              <p className="text-sm text-muted-foreground mt-1">
                This will delete ALL keys in the Redis database. This action cannot be undone.
              </p>
            </div>
            
            <div>
              <Label>Type "FLUSH REDIS" to confirm</Label>
              <Input
                value={redisFlushConfirm}
                onChange={(e) => setRedisFlushConfirm(e.target.value)}
                placeholder="FLUSH REDIS"
                className="mt-1"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRedisFlushOpen(false); setRedisFlushConfirm(''); }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={flushRedisDatabase}>
              Flush Database
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </>
      )}
    </div>
  );
}