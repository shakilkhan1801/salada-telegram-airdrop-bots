import React, { useState, useEffect } from 'react';
import { Server, RefreshCw, Eye, Trash2, Search, Key, AlertTriangle, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { toast } from 'sonner';

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

interface RedisKey {
  key: string;
  type: string;
  ttl: string;
  size: number;
}

interface RedisExplorerProps {
  open: boolean;
  onClose: () => void;
}

export default function RedisExplorer({ open, onClose }: RedisExplorerProps) {
  const [keys, setKeys] = useState<RedisKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [pattern, setPattern] = useState('*');
  const [searchInput, setSearchInput] = useState('*');
  const [cursor, setCursor] = useState('0');
  const [hasMore, setHasMore] = useState(false);
  
  const [selectedKey, setSelectedKey] = useState<any>(null);
  const [viewOpen, setViewOpen] = useState(false);
  
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [keysToDelete, setKeysToDelete] = useState<string[]>([]);
  
  const [flushOpen, setFlushOpen] = useState(false);
  const [flushConfirm, setFlushConfirm] = useState('');

  useEffect(() => {
    if (open) {
      void loadKeys(true);
    }
  }, [open, pattern]);

  async function loadKeys(reset: boolean = false) {
    setLoading(true);
    try {
      const currentCursor = reset ? '0' : cursor;
      const resp = await api<any>(`/db/redis-keys?pattern=${encodeURIComponent(pattern)}&cursor=${currentCursor}&count=50`);
      
      if (reset) {
        setKeys(resp?.data || []);
      } else {
        setKeys(prev => [...prev, ...(resp?.data || [])]);
      }
      
      setCursor(resp?.cursor || '0');
      setHasMore(resp?.hasMore || false);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load Redis keys');
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch() {
    setPattern(searchInput);
    setCursor('0');
  }

  async function viewKey(keyName: string) {
    try {
      const resp = await api<any>(`/db/redis-get?key=${encodeURIComponent(keyName)}`);
      setSelectedKey(resp?.data || null);
      setViewOpen(true);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to get key value');
    }
  }

  async function deleteKeys() {
    if (keysToDelete.length === 0) return;
    
    try {
      await api<any>('/db/redis-delete', {
        method: 'POST',
        body: JSON.stringify({ keys: keysToDelete })
      });
      
      toast.success(`Deleted ${keysToDelete.length} key(s)`);
      setDeleteOpen(false);
      setKeysToDelete([]);
      void loadKeys(true);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete keys');
    }
  }

  async function flushDatabase() {
    if (flushConfirm !== 'FLUSH REDIS') {
      toast.error('Type "FLUSH REDIS" to confirm');
      return;
    }
    
    try {
      await api<any>('/db/redis-flush', {
        method: 'POST',
        body: JSON.stringify({ confirm: flushConfirm })
      });
      
      toast.success('Redis database flushed');
      setFlushOpen(false);
      setFlushConfirm('');
      void loadKeys(true);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to flush Redis');
    }
  }

  function formatBytes(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5 text-red-600" />
            Redis Key Explorer
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search Bar */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label>Search Pattern</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="* or user:* or session:*"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
                <Button onClick={handleSearch} disabled={loading}>
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Use * for wildcard (e.g., user:* for all keys starting with "user:")
              </p>
            </div>
            <Button variant="outline" onClick={() => loadKeys(true)} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button variant="destructive" onClick={() => setFlushOpen(true)}>
              <Trash2 className="h-4 w-4 mr-2" />
              Flush DB
            </Button>
          </div>

          {/* Keys Table */}
          <div className="border rounded-lg">
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">Key</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>TTL</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead className="w-32">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((item) => (
                    <TableRow key={item.key}>
                      <TableCell className="font-mono text-xs truncate max-w-[300px]" title={item.key}>
                        <Key className="h-3 w-3 inline mr-1 text-muted-foreground" />
                        {item.key}
                      </TableCell>
                      <TableCell>
                        <Badge className={getTypeColor(item.type)}>
                          {item.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.ttl}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatBytes(item.size)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => viewKey(item.key)}
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setKeysToDelete([item.key]);
                              setDeleteOpen(true);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {keys.length === 0 && !loading && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                        No keys found matching pattern "{pattern}"
                      </TableCell>
                    </TableRow>
                  )}
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                        Loading keys...
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>

          {/* Load More */}
          {hasMore && !loading && (
            <div className="text-center">
              <Button variant="outline" onClick={() => loadKeys(false)}>
                Load More Keys
              </Button>
            </div>
          )}

          {/* Stats */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Showing {keys.length} key(s)</span>
            <span>Pattern: {pattern}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* View Key Dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              View Redis Key
            </DialogTitle>
          </DialogHeader>
          
          {selectedKey && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Key</Label>
                  <div className="font-mono text-sm bg-muted px-2 py-1 rounded mt-1 break-all">
                    {selectedKey.key}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Type</Label>
                  <div className="mt-1">
                    <Badge className={getTypeColor(selectedKey.type)}>
                      {selectedKey.type}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">TTL</Label>
                  <div className="text-sm mt-1">{selectedKey.ttl}</div>
                </div>
                <div>
                  <Label className="text-xs">Size</Label>
                  <div className="text-sm mt-1">{formatBytes(selectedKey.size)}</div>
                </div>
              </div>
              
              <div>
                <Label className="text-xs">Value</Label>
                <ScrollArea className="h-[300px] mt-1 border rounded p-3 bg-muted">
                  <pre className="text-xs">
                    {typeof selectedKey.value === 'object' 
                      ? JSON.stringify(selectedKey.value, null, 2)
                      : String(selectedKey.value || '')}
                  </pre>
                </ScrollArea>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
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
              {keysToDelete.map(key => (
                <div key={key} className="font-mono text-xs">{key}</div>
              ))}
            </div>
            <p className="text-xs text-destructive">This action cannot be undone.</p>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteKeys}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Flush Database Dialog */}
      <Dialog open={flushOpen} onOpenChange={setFlushOpen}>
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
                value={flushConfirm}
                onChange={(e) => setFlushConfirm(e.target.value)}
                placeholder="FLUSH REDIS"
                className="mt-1"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFlushOpen(false); setFlushConfirm(''); }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={flushDatabase}>
              Flush Database
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
