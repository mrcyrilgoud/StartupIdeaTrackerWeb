import React, { useState } from 'react';
import { Plus, Trash2, Folder as FolderIcon, LayoutGrid, Sparkles } from 'lucide-react';
import { Folder as FolderType } from '../../types';

interface FolderSidebarProps {
    folders: FolderType[];
    selectedFolderId: string;
    onSelectFolder: (folderId: string) => void;
    onCreateFolder: (name: string) => void;
    onDeleteFolder: (folderId: string) => void;
    onSmartOrganize: () => void;
    className?: string; // Allow customization of sidebar styles
}

export const FolderSidebar: React.FC<FolderSidebarProps> = ({
    folders,
    selectedFolderId,
    onSelectFolder,
    onCreateFolder,
    onDeleteFolder,
    onSmartOrganize,
    className
}) => {
    const [isCreating, setIsCreating] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');

    const handleCreateSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (newFolderName.trim()) {
            onCreateFolder(newFolderName.trim());
            setNewFolderName('');
            setIsCreating(false);
        }
    };

    return (
        <div className={`flex flex-col h-full bg-surface border-r border-border p-4 w-64 ${className}`}>
            <div className="mb-4">
                <h2 className="text-sm font-bold text-text-secondary uppercase tracking-wider mb-2 px-2">Library</h2>
                <div className="space-y-1">
                    <button
                        onClick={() => onSelectFolder('all')}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${selectedFolderId === 'all'
                            ? 'bg-accent/10 text-accent font-medium'
                            : 'text-text-primary hover:bg-background'
                            }`}
                    >
                        <LayoutGrid size={18} />
                        All Ideas
                    </button>
                    <button
                        onClick={() => onSelectFolder('uncategorized')}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${selectedFolderId === 'uncategorized'
                            ? 'bg-accent/10 text-accent font-medium'
                            : 'text-text-primary hover:bg-background'
                            }`}
                    >
                        <FolderIcon size={18} className="text-text-secondary" />
                        Uncategorized
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="flex items-center justify-between mb-2 px-2">
                    <h2 className="text-sm font-bold text-text-secondary uppercase tracking-wider">Folders</h2>
                    <div className="flex gap-1">
                        <button
                            onClick={onSmartOrganize}
                            className="p-1 hover:bg-background rounded-md text-text-secondary hover:text-purple-500 transition-colors"
                            title="Auto-Organize with AI"
                        >
                            <Sparkles size={16} />
                        </button>
                        <button
                            onClick={() => setIsCreating(true)}
                            className="p-1 hover:bg-background rounded-md text-text-secondary hover:text-accent transition-colors"
                            title="New Folder"
                        >
                            <Plus size={16} />
                        </button>
                    </div>
                </div>

                <div className="space-y-1">
                    {folders.map(folder => (
                        <div
                            key={folder.id}
                            className={`group flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${selectedFolderId === folder.id
                                ? 'bg-accent/10 text-accent font-medium'
                                : 'text-text-primary hover:bg-background'
                                }`}
                            onClick={() => onSelectFolder(folder.id)}
                        >
                            <div className="flex items-center gap-3 overflow-hidden">
                                <FolderIcon size={18} className="shrink-0" />
                                <span className="truncate">{folder.name}</span>
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm(`Delete folder "${folder.name}"? Ideas will strictly NOT be deleted.`)) {
                                        onDeleteFolder(folder.id);
                                    }
                                }}
                                className={`p-1 text-text-secondary hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity ${selectedFolderId === folder.id ? 'opacity-100' : ''}`}
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}

                    {isCreating && (
                        <form onSubmit={handleCreateSubmit} className="px-2 mt-2">
                            <input
                                autoFocus
                                type="text"
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                onBlur={() => {
                                    if (!newFolderName.trim()) setIsCreating(false);
                                }}
                                placeholder="Folder Name..."
                                className="w-full bg-background border border-accent rounded px-2 py-1 text-sm outline-none"
                            />
                        </form>
                    )}

                    {folders.length === 0 && !isCreating && (
                        <div className="px-3 py-4 text-xs text-text-secondary italic text-center opacity-60">
                            No folders yet
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
