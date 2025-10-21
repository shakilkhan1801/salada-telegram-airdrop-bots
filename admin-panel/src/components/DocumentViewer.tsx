import React, { useState, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Copy,
  Code,
  FileJson,
  Eye,
  ChevronDown,
  ChevronRight,
  Hash,
  Type,
  ToggleLeft,
  Calendar,
  List,
  Braces,
  X
} from "lucide-react";

interface DocumentViewerProps {
  document: any;
  open: boolean;
  onClose: () => void;
}

export function DocumentViewer({ document, open, onClose }: DocumentViewerProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['root']));
  const [viewMode, setViewMode] = useState<'tree' | 'json'>('tree');
  
  // Memoized JSON string to prevent re-computation
  const jsonString = useMemo(() => {
    return JSON.stringify(document, null, 2);
  }, [document]);

  const togglePath = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  }, []);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Copied to clipboard');
    }).catch(() => {
      toast.error('Failed to copy');
    });
  }, []);

  const getValueType = useCallback((value: any): { type: string; icon: any; color: string } => {
    if (value === null) return { type: 'null', icon: X, color: 'text-gray-500' };
    if (value === undefined) return { type: 'undefined', icon: X, color: 'text-gray-500' };
    if (typeof value === 'string') return { type: 'string', icon: Type, color: 'text-green-600' };
    if (typeof value === 'number') return { type: 'number', icon: Hash, color: 'text-blue-600' };
    if (typeof value === 'boolean') return { type: 'boolean', icon: ToggleLeft, color: 'text-purple-600' };
    if (value instanceof Date) return { type: 'date', icon: Calendar, color: 'text-orange-600' };
    if (Array.isArray(value)) return { type: 'array', icon: List, color: 'text-indigo-600' };
    if (typeof value === 'object') return { type: 'object', icon: Braces, color: 'text-violet-600' };
    return { type: 'unknown', icon: X, color: 'text-gray-500' };
  }, []);

  const renderValue = useCallback((value: any, path: string = '', level: number = 0): JSX.Element => {
    const { type, icon: Icon, color } = getValueType(value);
    const isExpanded = expandedPaths.has(path);
    const indentColor = level % 2 === 0 ? 'border-violet-200' : 'border-purple-200';

    if (type === 'object' && value !== null) {
      const keys = Object.keys(value);
      const isObjectId = keys.length === 1 && keys[0] === '$oid';
      
      if (isObjectId) {
        return (
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-violet-100 dark:bg-violet-900/20">
              <Hash className="h-3 w-3 text-violet-600" />
            </span>
            <span className={`font-mono text-sm ${color}`}>
              ObjectId("{value.$oid}")
            </span>
          </div>
        );
      }

      return (
        <div className="space-y-1">
          <button
            onClick={() => togglePath(path)}
            className={`group flex items-center gap-2 hover:bg-muted/60 rounded-lg px-2 py-1 -ml-2 transition-all duration-200 ${
              isExpanded ? 'bg-muted/30' : ''
            }`}
          >
            <div className={`transition-transform duration-200 ${
              isExpanded ? 'rotate-90' : ''
            }`}>
              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
            </div>
            <div className={`p-1.5 rounded-lg bg-gradient-to-br ${type === 'array' ? 'from-indigo-100 to-indigo-200 dark:from-indigo-900/20 dark:to-indigo-800/20' : 'from-violet-100 to-violet-200 dark:from-violet-900/20 dark:to-violet-800/20'}`}>
              <Icon className={`h-4 w-4 ${type === 'array' ? 'text-indigo-600 dark:text-indigo-400' : 'text-violet-600 dark:text-violet-400'}`} />
            </div>
            <span className="text-sm font-medium text-foreground group-hover:text-foreground">
              {type === 'array' ? `Array [${value.length}]` : `Object {${keys.length}}`}
            </span>
            <span className="text-xs text-muted-foreground ml-auto">
              {isExpanded ? 'collapse' : 'expand'}
            </span>
          </button>
          {isExpanded && (
            <div className={`ml-6 space-y-2 pl-4 border-l-2 ${indentColor} transition-all duration-300`}>
              {type === 'array' ? (
                value.map((item: any, index: number) => (
                  <div key={index} className="group flex items-start gap-3 py-1">
                    <div className="flex items-center gap-2 min-w-[3rem]">
                      <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-0.5 rounded">
                        {index}
                      </span>
                    </div>
                    <div className="flex-1">
                      {renderValue(item, `${path}[${index}]`, level + 1)}
                    </div>
                  </div>
                ))
              ) : (
                keys.map(key => (
                  <div key={key} className="group flex items-start gap-3 py-1">
                    <div className="flex items-center gap-2 min-w-[8rem]">
                      <span className="font-mono text-sm font-medium text-foreground bg-muted/50 px-2 py-0.5 rounded">
                        {key}
                      </span>
                    </div>
                    <div className="flex-1">
                      {renderValue(value[key], `${path}.${key}`, level + 1)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      );
    }

    if (type === 'string') {
      // Check if it's a date string
      const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      if (dateRegex.test(value)) {
        return (
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-orange-100 dark:bg-orange-900/20">
              <Calendar className="h-3 w-3 text-orange-600" />
            </span>
            <span className={`font-mono text-sm ${color}`}>
              "{new Date(value).toLocaleString()}"
            </span>
          </div>
        );
      }
      
      // Check if it's a long string
      const isLong = value.length > 50;
      const displayValue = isLong ? value.slice(0, 47) + '…' : value;
      
      return (
        <div className="flex items-center gap-2">
          <span className="p-1 rounded bg-green-100 dark:bg-green-900/20">
            <Type className="h-3 w-3 text-green-600" />
          </span>
          <span className={`font-mono text-sm ${color} ${isLong ? 'cursor-help' : ''}`} title={isLong ? value : undefined}>
            "{displayValue}"
          </span>
          {isLong && (
            <Badge variant="outline" className="text-xs">
              {value.length} chars
            </Badge>
          )}
        </div>
      );
    }

    if (type === 'number') {
      return (
        <div className="flex items-center gap-2">
          <span className="p-1 rounded bg-blue-100 dark:bg-blue-900/20">
            <Hash className="h-3 w-3 text-blue-600" />
          </span>
          <span className={`font-mono text-sm font-semibold ${color}`}>
            {Intl.NumberFormat().format(value)}
          </span>
        </div>
      );
    }

    if (type === 'boolean') {
      return (
        <div className="flex items-center gap-2">
          <span className={`p-1 rounded ${value ? 'bg-green-100 dark:bg-green-900/20' : 'bg-gray-100 dark:bg-gray-900/20'}`}>
            <ToggleLeft className={`h-3 w-3 ${value ? 'text-green-600' : 'text-gray-600'}`} />
          </span>
          <Badge variant={value ? 'default' : 'secondary'} className="text-xs font-semibold">
            {value ? 'true' : 'false'}
          </Badge>
        </div>
      );
    }

    if (type === 'null' || type === 'undefined') {
      return (
        <div className="flex items-center gap-2">
          <span className="p-1 rounded bg-gray-100 dark:bg-gray-900/20">
            <X className="h-3 w-3 text-gray-500" />
          </span>
          <Badge variant="outline" className="text-xs font-mono">
            {type}
          </Badge>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2">
        <span className="p-1 rounded bg-gray-100 dark:bg-gray-900/20">
          <X className="h-3 w-3 text-gray-500" />
        </span>
        <span className={`font-mono text-sm ${color}`}>{String(value)}</span>
      </div>
    );
  }, [expandedPaths, getValueType, togglePath]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0">
        <DialogHeader className="px-6 py-4 border-b bg-muted/30">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <FileJson className="h-5 w-5" />
              Document Viewer
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(jsonString)}
                className="gap-2"
              >
                <Copy className="h-4 w-4" />
                Copy JSON
              </Button>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)} className="flex-1">
          <div className="px-6 py-2 border-b">
            <TabsList className="grid w-[200px] grid-cols-2">
              <TabsTrigger value="tree" className="gap-2">
                <Eye className="h-4 w-4" />
                Tree View
              </TabsTrigger>
              <TabsTrigger value="json" className="gap-2">
                <Code className="h-4 w-4" />
                JSON View
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="overflow-auto max-h-[65vh]">
            {viewMode === 'tree' ? (
              <div className="px-6 py-4">
                <div className="space-y-2">
                  {document && (
                    <div className="space-y-1">
                      <button
                        onClick={() => togglePath('root')}
                        className="flex items-center gap-1 hover:bg-muted/50 rounded px-1 -ml-1 transition-colors"
                      >
                        {expandedPaths.has('root') ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        <Braces className="h-3 w-3 text-violet-600" />
                        <span className="text-sm text-muted-foreground font-medium">Document</span>
                        <span className="text-xs text-muted-foreground ml-2">{Object.keys(document || {}).length} fields</span>
                      </button>
                      {expandedPaths.has('root') && (
                        <div className="ml-4 space-y-1 pl-3 border-l border-border">
                          {Object.entries(document || {}).map(([key, value]) => (
                            <div key={key} className="flex items-start gap-2">
                              <span className="font-mono text-sm text-foreground min-w-[8rem]">{key}:</span>
                              {renderValue(value, key, 1)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="px-6 py-4">
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(jsonString)}
                    className="absolute right-2 top-2 gap-2 z-10"
                  >
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                  <pre className="bg-muted/50 rounded-lg p-4 overflow-x-auto">
                    <code className="text-sm font-mono">
                      {jsonString}
                    </code>
                  </pre>
                </div>
              </div>
            )}
          </div>
        </Tabs>

        <DialogFooter className="px-6 py-3 border-t bg-muted/10">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}