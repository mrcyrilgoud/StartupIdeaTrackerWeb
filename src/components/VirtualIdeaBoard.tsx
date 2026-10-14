import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Folder as FolderIcon, FolderOutput, LayoutGrid, Search, Trash2 } from 'lucide-react';
import type { Folder, IdeaSummary } from '../types';
import { STATUS_COLORS, STATUS_LABELS } from '../types';

const MIN_CARD_WIDTH = 300;
const GRID_GAP = 24;

export type IdeaBoardRow =
    | {
        kind: 'header';
        key: string;
        folderId: string;
        title: string;
        count: number;
        isUncategorized: boolean;
        isEmpty: boolean;
    }
    | {
        kind: 'cards';
        key: string;
        folderId: string;
        ideas: IdeaSummary[];
    };

type IdeaBoardSection = {
    folderId: string;
    title: string;
    isUncategorized: boolean;
    ideas: IdeaSummary[];
};

export function buildIdeaBoardRows(
    ideas: IdeaSummary[],
    folders: Folder[],
    selectedFolderId: string,
    validFolderIds: Set<string>,
    columnCount: number,
    dragOverFolderId: string | null
): IdeaBoardRow[] {
    const sections: IdeaBoardSection[] = [];

    if (selectedFolderId === 'all') {
        const grouped = new Map<string, IdeaSummary[]>();
        for (const idea of ideas) {
            const folderId = idea.folder_id && validFolderIds.has(idea.folder_id) ? idea.folder_id : 'uncategorized';
            const folderIdeas = grouped.get(folderId) ?? [];
            folderIdeas.push(idea);
            grouped.set(folderId, folderIdeas);
        }

        for (const folder of folders) {
            const folderIdeas = grouped.get(folder.id) ?? [];
            if (folderIdeas.length > 0 || dragOverFolderId === folder.id) {
                sections.push({ folderId: folder.id, title: folder.name, isUncategorized: false, ideas: folderIdeas });
            }
        }

        const uncategorizedIdeas = grouped.get('uncategorized') ?? [];
        if (uncategorizedIdeas.length > 0 || dragOverFolderId === 'uncategorized') {
            sections.push({ folderId: 'uncategorized', title: 'Uncategorized', isUncategorized: true, ideas: uncategorizedIdeas });
        }
    } else {
        sections.push({
            folderId: selectedFolderId,
            title: '',
            isUncategorized: selectedFolderId === 'uncategorized',
            ideas
        });
    }

    return sections.flatMap((section) => {
        const rows: IdeaBoardRow[] = [];
        if (selectedFolderId === 'all') {
            rows.push({
                kind: 'header',
                key: `header:${section.folderId}`,
                folderId: section.folderId,
                title: section.title,
                count: section.ideas.length,
                isUncategorized: section.isUncategorized,
                isEmpty: section.ideas.length === 0
            });
        }

        for (let start = 0; start < section.ideas.length; start += columnCount) {
            rows.push({
                kind: 'cards',
                key: `cards:${section.folderId}:${start}`,
                folderId: section.folderId,
                ideas: section.ideas.slice(start, start + columnCount)
            });
        }
        return rows;
    });
}

type VirtualIdeaBoardProps = {
    ideas: IdeaSummary[];
    folders: Folder[];
    selectedFolderId: string;
    dragOverFolderId: string | null;
    scrollElementRef: React.RefObject<HTMLDivElement>;
    resetKey: string;
    onDragStart: (event: React.DragEvent, idea: IdeaSummary) => void;
    onDragOver: (event: React.DragEvent, folderId: string) => void;
    onDragLeave: (event: React.DragEvent) => void;
    onDrop: (event: React.DragEvent, folderId: string) => void;
    onAnalyzeViability: (event: React.MouseEvent, idea: IdeaSummary) => void;
    onMoveStart: (event: React.MouseEvent, idea: IdeaSummary) => void;
    onDeleteIdea: (event: React.MouseEvent, idea: IdeaSummary) => void;
    onNavigate: (ideaId: string) => void;
};

export const VirtualIdeaBoard: React.FC<VirtualIdeaBoardProps> = ({
    ideas,
    folders,
    selectedFolderId,
    dragOverFolderId,
    scrollElementRef,
    resetKey,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onAnalyzeViability,
    onMoveStart,
    onDeleteIdea,
    onNavigate
}) => {
    const boardRef = useRef<HTMLDivElement>(null);
    const [columnCount, setColumnCount] = useState(1);
    const [scrollMargin, setScrollMargin] = useState(0);
    const validFolderIds = useMemo(() => new Set(folders.map((folder) => folder.id)), [folders]);
    const rows = useMemo(
        () => buildIdeaBoardRows(ideas, folders, selectedFolderId, validFolderIds, columnCount, dragOverFolderId),
        [ideas, folders, selectedFolderId, validFolderIds, columnCount, dragOverFolderId]
    );

    const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
        count: rows.length,
        getScrollElement: () => scrollElementRef.current,
        estimateSize: (index) => rows[index]?.kind === 'header' ? 64 : 250,
        getItemKey: (index) => rows[index]?.key ?? `row:${index}`,
        overscan: 3,
        scrollMargin
    });

    useLayoutEffect(() => {
        const board = boardRef.current;
        if (!board) return;

        const updateMeasurements = () => {
            const nextColumns = Math.max(1, Math.floor((board.clientWidth + GRID_GAP) / (MIN_CARD_WIDTH + GRID_GAP)));
            setColumnCount((current) => current === nextColumns ? current : nextColumns);

            const scrollElement = scrollElementRef.current;
            if (!scrollElement) return;
            const nextMargin = board.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop;
            setScrollMargin((current) => Math.abs(current - nextMargin) < 1 ? current : nextMargin);
        };

        updateMeasurements();
        const observer = new ResizeObserver(updateMeasurements);
        observer.observe(board);
        return () => observer.disconnect();
    }, [scrollElementRef]);

    useEffect(() => {
        rowVirtualizer.measure();
    }, [rowVirtualizer, rows.length, columnCount]);

    useEffect(() => {
        rowVirtualizer.scrollToOffset(0);
        rowVirtualizer.measure();
    }, [rowVirtualizer, resetKey]);

    const renderCard = (idea: IdeaSummary) => (
        <div
            key={idea.id}
            data-testid="home-idea-card"
            data-idea-id={idea.id}
            draggable={true}
            onDragStart={(event) => onDragStart(event, idea)}
            className="card group relative flex flex-col h-full cursor-pointer overflow-hidden border-t-4 border-t-transparent hover:border-t-accent transition-all duration-200 hover:-translate-y-1 hover:shadow-lg active:cursor-grabbing"
            onClick={(event) => {
                if ((event.target as HTMLElement).closest('button')) return;
                onNavigate(idea.id);
            }}
        >
            <div className="flex justify-between items-start mb-3">
                <h3 className="m-0 text-lg font-bold pr-2 text-text-primary leading-tight">{idea.title}</h3>
                {idea.status && (
                    <span
                        className="text-[10px] uppercase font-bold px-2 py-1 rounded-full whitespace-nowrap"
                        style={{
                            backgroundColor: `${STATUS_COLORS[idea.status]}20`,
                            color: STATUS_COLORS[idea.status],
                            border: `1px solid ${STATUS_COLORS[idea.status]}40`
                        }}
                    >
                        {STATUS_LABELS[idea.status]}
                    </span>
                )}
            </div>

            <p className="flex-1 text-text-secondary line-clamp-3 overflow-hidden text-sm leading-relaxed mb-4">
                {idea.details || 'No details provided...'}
            </p>

            <div className="flex flex-wrap gap-2 mb-4">
                {(idea.keywords || []).slice(0, 3).map((keyword, index) => (
                    <span key={`${idea.id}-keyword-${index}`} className="text-[10px] font-bold uppercase tracking-wider bg-accent/5 text-accent px-2 py-1 rounded-md border border-accent/10">
                        {keyword}
                    </span>
                ))}
            </div>

            <div className="mt-auto pt-4 border-t border-border/50 flex gap-2" onClick={(event) => event.stopPropagation()}>
                <button
                    onClick={(event) => onAnalyzeViability(event, idea)}
                    className="flex-1 btn-text text-xs justify-center bg-background hover:bg-accent hover:text-white border border-border/50"
                    title="Analyze business viability"
                >
                    <Search size={14} /> Viability
                </button>
                <button onClick={(event) => onMoveStart(event, idea)} className="btn-icon p-1.5 text-text-secondary hover:text-accent hover:bg-accent/10 rounded-lg transition-colors" title="Move to Folder">
                    <FolderOutput size={16} />
                </button>
                <button onClick={(event) => onDeleteIdea(event, idea)} className="btn-icon p-1.5 text-text-secondary hover:text-danger hover:bg-danger/10 rounded-lg transition-colors" title="Delete this idea">
                    <Trash2 size={16} />
                </button>
            </div>
        </div>
    );

    return (
        <div ref={boardRef} data-testid="home-idea-board" className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;
                const isDragOver = dragOverFolderId === row.folderId;
                const dropProps = {
                    onDragOver: (event: React.DragEvent) => onDragOver(event, row.folderId),
                    onDragLeave,
                    onDrop: (event: React.DragEvent) => onDrop(event, row.folderId)
                };

                return (
                    <div
                        key={row.key}
                        ref={rowVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        className="absolute left-0 top-0 w-full"
                        style={{ transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)` }}
                    >
                        {row.kind === 'header' ? (
                            <div
                                {...dropProps}
                                className={`rounded-xl px-1 ${isDragOver ? 'bg-accent/5 ring-2 ring-accent ring-inset p-4' : ''}`}
                            >
                                <div className="flex items-center gap-2 mb-4 text-text-secondary border-b border-border/50 pb-2">
                                    {row.isUncategorized ? <LayoutGrid size={20} /> : <FolderIcon size={20} className="text-accent" />}
                                    <h3 className="text-xl font-bold text-text-primary">{row.title}</h3>
                                    <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-bold">{row.count}</span>
                                    {isDragOver && <span className="ml-auto text-xs text-accent font-bold animate-pulse">{row.isUncategorized ? 'Drop to remove from folder' : 'Drop to move here'}</span>}
                                </div>
                                {row.isEmpty && isDragOver && (
                                    <div className="h-32 border-2 border-dashed border-accent/30 rounded-lg flex items-center justify-center text-accent/50 text-sm">Drop idea here</div>
                                )}
                            </div>
                        ) : (
                            <div
                                {...dropProps}
                                className={`grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6 w-full px-1 pb-6 rounded-xl transition-all ${isDragOver ? 'bg-accent/5 ring-2 ring-accent ring-inset p-4' : ''}`}
                            >
                                {row.ideas.map(renderCard)}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
