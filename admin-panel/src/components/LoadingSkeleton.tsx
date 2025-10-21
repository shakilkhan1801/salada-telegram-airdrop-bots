import React from 'react';

interface LoadingSkeletonProps {
  lines?: number;
  className?: string;
}

export function LoadingSkeleton({ lines = 3, className = "" }: LoadingSkeletonProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div 
          key={i} 
          className="animate-pulse flex space-x-4"
        >
          <div className="rounded bg-muted h-4 w-16"></div>
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-3 bg-muted rounded w-1/2"></div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableLoadingSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="animate-pulse flex space-x-4 py-3">
          {Array.from({ length: cols }).map((_, colIndex) => (
            <div
              key={colIndex}
              className={`h-4 bg-muted rounded ${
                colIndex === 0 ? 'w-20' : colIndex === 1 ? 'w-32' : 'flex-1'
              }`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function DocumentLoadingSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <div className="animate-pulse space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-muted rounded"></div>
          <div className="h-4 bg-muted rounded w-24"></div>
          <div className="h-3 bg-muted rounded w-16"></div>
        </div>
        
        <div className="ml-6 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-3 bg-muted rounded w-20"></div>
              <div className="h-4 bg-muted rounded flex-1 max-w-xs"></div>
            </div>
          ))}
        </div>
        
        <div className="flex items-center gap-2 mt-4">
          <div className="w-4 h-4 bg-muted rounded"></div>
          <div className="h-4 bg-muted rounded w-32"></div>
        </div>
        
        <div className="ml-6 space-y-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-3 bg-muted rounded w-8"></div>
              <div className="h-3 bg-muted rounded flex-1 max-w-sm"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}