import React from 'react';
import { Folder as FolderIcon, X, LayoutGrid } from 'lucide-react';
import { Folder } from '../types';

interface MoveToFolderModalProps {
    isOpen: boolean;
    onClose: () => void;
    onMove: (folderId?: string) => void;
    folders: Folder[];
    currentFolderId?: string;
}

export const MoveToFolderModal: React.FC<MoveToFolderModalProps> = ({
    isOpen,
    onClose,
    onMove,
    folders,
    currentFolderId
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h3 className="font-bold flex items-center gap-2">
                        <FolderIcon size={18} className="text-accent" />
                        Move to Folder
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-background rounded-full transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-2 max-h-[60vh] overflow-y-auto">
                    <button
                        onClick={() => onMove(undefined)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${!currentFolderId
                                ? 'bg-accent/10 text-accent font-bold'
                                : 'hover:bg-background text-text-primary'
                            }`}
                    >
                        <LayoutGrid size={20} />
                        <span>Uncategorized</span>
                        {!currentFolderId && <span className="ml-auto text-xs bg-accent/20 px-2 py-0.5 rounded-full">Current</span>}
                    </button>

                    <div className="h-px bg-border my-2 mx-2" />

                    {folders.length === 0 ? (
                        <div className="p-4 text-center text-text-secondary text-sm italic">
                            No folders created yet.
                        </div>
                    ) : (
                        folders.map(folder => (
                            <button
                                key={folder.id}
                                onClick={() => onMove(folder.id)}
                                className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${currentFolderId === folder.id
                                        ? 'bg-accent/10 text-accent font-bold'
                                        : 'hover:bg-background text-text-primary'
                                    }`}
                            >
                                <FolderIcon size={20} />
                                <span className="truncate">{folder.name}</span>
                                {currentFolderId === folder.id && <span className="ml-auto text-xs bg-accent/20 px-2 py-0.5 rounded-full">Current</span>}
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
