import { useAiConnection } from '../context/AiConnectionContext';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Sparkles, Search, Menu, AlertTriangle } from 'lucide-react';
import { dbService } from '../services/db';
import { aiService, isStructuredParseError, MVPAnalysisResult } from '../services/ai';
import { Idea, IdeaSummary, IdeaStatus, STATUS_LABELS, Folder, VettingResult, VettingCriteria } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { MVPResultModal } from '../components/MVPResultModal';
import { BusinessViabilityModal } from '../components/BusinessViabilityModal';
import { VettingModal } from '../components/VettingModal';
import { HomeChat } from '../components/features/HomeChat';
import { FolderSidebar } from '../components/features/FolderSidebar';
import { MoveToFolderModal } from '../components/MoveToFolderModal';
import { SmartOrganizeModal } from '../components/SmartOrganizeModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { VirtualIdeaBoard } from '../components/VirtualIdeaBoard';

export const Home: React.FC = () => {
    const { ready } = useAiConnection();
    const [aiError, setAiError] = useState<string | null>(null);
    const [ideas, setIdeas] = useState<IdeaSummary[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [ideasLoading, setIdeasLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const loadRequestIdRef = React.useRef(0);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
    const [creatingIdea, setCreatingIdea] = useState(false);

    const [error, setError] = useState<string | null>(null);
    const [analyzingMVP, setAnalyzingMVP] = useState(false);
    const [mvpResult, setMvpResult] = useState<MVPAnalysisResult[] | null>(null);
    const [mvpRawOutput, setMvpRawOutput] = useState<string | null>(null);
    const [showMVPModal, setShowMVPModal] = useState(false);

    // Vetting state
    const [isVetting, setIsVetting] = useState(false);
    const [vettingResults, setVettingResults] = useState<VettingResult[]>([]);
    const [vettingRawOutput, setVettingRawOutput] = useState<string | null>(null);
    const [currentCriteria, setCurrentCriteria] = useState<VettingCriteria | null>(null);
    const [showVettingModal, setShowVettingModal] = useState(false);

    // Viability analysis state
    const [viabilityLoading, setViabilityLoading] = useState(false);
    const [viabilityReport, setViabilityReport] = useState('');
    const [viabilityError, setViabilityError] = useState<string | null>(null);
    const [viabilityIdeaTitle, setViabilityIdeaTitle] = useState('');
    const [showViabilityModal, setShowViabilityModal] = useState(false);

    // Delete confirmation state
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [ideaToDelete, setIdeaToDelete] = useState<IdeaSummary | null>(null);

    // Move Idea state
    const [showMoveModal, setShowMoveModal] = useState(false);
    const [ideaToMove, setIdeaToMove] = useState<IdeaSummary | null>(null);

    // Smart Organize state
    const [showSmartOrganizeModal, setShowSmartOrganizeModal] = useState(false);
    const [smartSuggestions, setSmartSuggestions] = useState<any[]>([]);
    const [smartOrganizeRawOutput, setSmartOrganizeRawOutput] = useState<string | null>(null);
    const [isSmartAnalyzing, setIsSmartAnalyzing] = useState(false);

    // Auto-scroll ref
    const mainContainerRef = React.useRef<HTMLDivElement>(null);

    // Drag over state for "All Ideas" view
    const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

    // Filter & Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<IdeaStatus | 'all'>('all');
    const [sortOption, setSortOption] = useState<'newest' | 'oldest' | 'az'>('newest');

    const navigate = useNavigate();

    const loadData = async (cursor?: string) => {
        const requestId = ++loadRequestIdRef.current;
        try {
            setError(null);
            if (cursor) setLoadingMore(true);
            else setIdeasLoading(true);
            const [summaryPage, loadedFolders] = await Promise.all([
                dbService.getIdeaSummaries({
                    query: searchQuery,
                    status: statusFilter,
                    folderId: selectedFolderId,
                    limit: 50,
                    cursor
                }),
                cursor ? Promise.resolve(folders) : dbService.getAllFolders()
            ]);
            if (requestId !== loadRequestIdRef.current) return;
            setIdeas(prev => cursor ? [...prev, ...summaryPage.items] : summaryPage.items);
            setNextCursor(summaryPage.nextCursor);
            if (!cursor) setFolders(loadedFolders);
        } catch (e) {
            setError("Could not connect to the database. Make sure 'npm run dev' is running.");
        } finally {
            if (requestId === loadRequestIdRef.current) {
                setIdeasLoading(false);
                setLoadingMore(false);
            }
        }
    };

    useEffect(() => {
        void loadData();
    }, [searchQuery, statusFilter, selectedFolderId]);

    const loadMoreIdeas = () => {
        if (!nextCursor || loadingMore) return;
        void loadData(nextCursor);
    };

    const handleCreateFolder = async (name: string) => {
        try {
            const newFolder: Folder = {
                id: uuidv4(),
                name,
                timestamp: Date.now()
            };
            await dbService.saveFolder(newFolder);
            setFolders(prev => [...prev, newFolder]);
            setSelectedFolderId(newFolder.id);
        } catch (e) {
            console.error('Failed to create folder:', e);
            alert('Failed to create folder');
        }
    };

    const handleDeleteFolder = async (folder_id: string) => {
        try {
            await dbService.deleteFolder(folder_id);
            setFolders(prev => prev.filter(f => f.id !== folder_id));
            if (selectedFolderId === folder_id) {
                setSelectedFolderId('all');
            }
            // Update ideas in this folder to have no folder_id (Uncategorized)
            const orphanedIdeas = ideas.filter(i => i.folder_id === folder_id);
            if (orphanedIdeas.length > 0) {
                setIdeas(prev => prev.map(i =>
                    i.folder_id === folder_id ? { ...i, folder_id: undefined } : i
                ));

                // Update the backend to persist the 'unassigned' state
                Promise.all(orphanedIdeas.map(idea => {
                    return dbService.updateIdea(idea.id, { folder_id: null });
                })).catch(err => console.error("Failed to unset folder_id for orphaned ideas:", err));
            }
        } catch (e) {
            console.error('Failed to delete folder:', e);
            alert('Failed to delete folder');
        }
    };

    const createNewIdea = async () => {
        const newIdea: Idea = {
            id: uuidv4(),
            title: 'New Idea',
            details: '',
            timestamp: Date.now(),
            keywords: [],
            chatHistory: [],
            relatedIdeas: [],
            status: 'draft',
            folder_id: selectedFolderId !== 'all' ? selectedFolderId : undefined
        };

        setCreatingIdea(true);
        try {
            await dbService.saveIdea(newIdea);
            navigate(`/idea/${newIdea.id}`);
        } catch (e) {
            console.error('Failed to create idea:', e);
            alert('Failed to create idea');
        } finally {
            setCreatingIdea(false);
        }
    };

    const handleAnalyzeViability = async (e: React.MouseEvent, idea: IdeaSummary) => {
        e.preventDefault(); // Prevent navigation to detail page
        e.stopPropagation();
        if (!ready) return;
        setAiError(null);

        try {
            setViabilityIdeaTitle(idea.title);
            setViabilityReport('');
            setViabilityError(null);
            setShowViabilityModal(true);
            setViabilityLoading(true);



            const report = await aiService.generateViabilityReport(idea);
            setViabilityReport(report);
        } catch (e) {
            console.error(e);
            setViabilityError(`Error generating report: ${(e as Error).message}`);
        } finally {
            setViabilityLoading(false);
        }
    };

    const handleAnalyzeMVP = async () => {
        if (!ready) return;
        setAiError(null);
        if (filteredIdeas.length === 0) {
            alert("No ideas to analyze in this view!");
            return;
        }

        try {
            setAnalyzingMVP(true);
            setMvpResult(null);
            setMvpRawOutput(null);


            const result = await aiService.findSimplestMVP(filteredIdeas);
            setMvpResult(result);
            setShowMVPModal(true);
        } catch (e) {
            if (isStructuredParseError(e)) {
                setMvpRawOutput(e.rawOutput);
                setShowMVPModal(true);
            } else {
                console.error(e);
                setAiError((e as Error).message);
            }
        } finally {
            setAnalyzingMVP(false);
        }
    };

    const handleDeleteIdea = (e: React.MouseEvent, idea: IdeaSummary) => {
        e.preventDefault();
        e.stopPropagation();
        setIdeaToDelete(idea);
        setShowDeleteModal(true);
    };

    const confirmDeleteIdea = async () => {
        if (!ideaToDelete) return;

        try {
            await dbService.deleteIdea(ideaToDelete.id);
            setIdeas(prev => prev.filter(i => i.id !== ideaToDelete.id));
        } catch (e) {
            console.error('Failed to delete idea:', e);
            alert('Failed to delete idea. Please try again.');
        } finally {
            setShowDeleteModal(false);
            setIdeaToDelete(null);
        }
    };

    const handleMoveStart = (e: React.MouseEvent, idea: IdeaSummary) => {
        e.preventDefault();
        e.stopPropagation();
        setIdeaToMove(idea);
        setShowMoveModal(true);
    };

    const handleMoveComplete = async (folder_id?: string) => {
        if (!ideaToMove) return;

        try {
            const updatedIdea = { ...ideaToMove, folder_id };
            await dbService.updateIdea(ideaToMove.id, { folder_id: folder_id ?? null });

            // Update local state
            setIdeas(prev => prev.map(i => i.id === ideaToMove.id ? updatedIdea : i));

            setShowMoveModal(false);
            setIdeaToMove(null);
        } catch (e) {
            console.error('Failed to move idea:', e);
            alert('Failed to move idea');
        }
    };

    const handleDragStart = (e: React.DragEvent, idea: IdeaSummary) => {
        e.dataTransfer.setData('ideaId', idea.id);
        e.dataTransfer.effectAllowed = 'move';
        // Add a visual drag image if needed, or let browser handle it
    };

    const handleDropIdea = (folder_id: string, ideaId: string) => {
        // Find idea in current state to update DB
        const idea = ideas.find(i => i.id === ideaId);
        if (!idea) return;

        const targetFolderId = folder_id === 'uncategorized' ? undefined : folder_id;
        if (idea.folder_id === targetFolderId) return;

        const updatedIdea = { ...idea, folder_id: targetFolderId };

        // Optimistic Update
        setIdeas(prev => prev.map(i => i.id === ideaId ? updatedIdea : i));

        // Async DB Update
        dbService.updateIdea(ideaId, { folder_id: targetFolderId ?? null }).catch(e => {
            console.error('Failed to move idea via drag and drop:', e);
            alert('Failed to move idea, reverting changes...');
            // Revert
            setIdeas(prev => prev.map(i => i.id === ideaId ? idea : i));
        });
    };

    const handleDragOver = (e: React.DragEvent, folder_id: string) => {
        e.preventDefault();
        e.stopPropagation();

        if (dragOverFolderId !== folder_id) {
            setDragOverFolderId(folder_id);
        }

        // Trigger auto-scroll manually since we stopped propagation
        handleAutoScroll(e);
    };

    const handleAutoScroll = (e: React.DragEvent) => {
        const container = mainContainerRef.current;
        if (!container) return;

        const { top, bottom } = container.getBoundingClientRect();
        const clientY = e.clientY;

        // Threshold in pixels (e.g. 100px from edge)
        const threshold = 100;
        const scrollSpeed = 10;

        if (clientY < top + threshold) {
            // Scroll Up
            container.scrollTop -= scrollSpeed;
        } else if (clientY > bottom - threshold) {
            // Scroll Down
            container.scrollTop += scrollSpeed;
        }
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget.contains(e.relatedTarget as Node)) {
            return;
        }
        setDragOverFolderId(null);
    };

    const handleGroupDrop = (e: React.DragEvent, folder_id: string) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverFolderId(null);
        const ideaId = e.dataTransfer.getData('ideaId');
        if (ideaId) {
            handleDropIdea(folder_id, ideaId);
        }
    };

    const handleSmartOrganize = async () => {
        if (!ready) return;
        setAiError(null);
        try {
            setShowSmartOrganizeModal(true);
            setIsSmartAnalyzing(true);
            setSmartSuggestions([]);
            setSmartOrganizeRawOutput(null);



            const suggestions = await aiService.suggestFolders(ideas, folders);
            setSmartSuggestions(suggestions);
        } catch (e) {
            if (isStructuredParseError(e)) {
                setSmartOrganizeRawOutput(e.rawOutput);
            } else {
                console.error("Smart Organize failed:", e);
                setAiError((e as Error).message);
                setShowSmartOrganizeModal(false);
            }
        } finally {
            setIsSmartAnalyzing(false);
        }
    };

    const handleApplySmartOrganize = async (selectedSuggestions: any[]) => {
        try {
            setIsSmartAnalyzing(true); // Re-use loading state for applying

            // 1. Create new folders or find existing ones
            const currentFolders = [...folders];
            const newFoldersMap = new Map<string, string>(); // Name -> ID

            for (const suggestion of selectedSuggestions) {
                let targetFolder = currentFolders.find(f => f.name.toLowerCase() === suggestion.name.toLowerCase());

                if (!targetFolder) {
                    // Create new folder
                    const newFolder: Folder = {
                        id: uuidv4(),
                        name: suggestion.name,
                        timestamp: Date.now()
                    };
                    await dbService.saveFolder(newFolder);
                    currentFolders.push(newFolder);
                    targetFolder = newFolder;
                }

                newFoldersMap.set(suggestion.name, targetFolder.id);
            }

            // 2. Update Ideas
            const updatedIdeas = [...ideas];
            const updatePromises: Promise<any>[] = [];

            for (const suggestion of selectedSuggestions) {
                const folder_id = newFoldersMap.get(suggestion.name);
                if (!folder_id) continue;

                for (const ideaId of suggestion.ideaIds) {
                    const ideaIndex = updatedIdeas.findIndex(i => i.id === ideaId);
                    if (ideaIndex !== -1) {
                        const updatedIdea = { ...updatedIdeas[ideaIndex], folder_id };
                        updatedIdeas[ideaIndex] = updatedIdea;
                        updatePromises.push(dbService.updateIdea(ideaId, { folder_id }));
                    }
                }
            }

            await Promise.all(updatePromises);

            // 3. Update State
            setFolders(currentFolders);
            setIdeas(updatedIdeas);
            setShowSmartOrganizeModal(false);

            alert(`Successfully organized ${updatePromises.length} ideas into ${selectedSuggestions.length} folders!`);

        } catch (e) {
            console.error("Failed to apply smart organization:", e);
            alert("Failed to apply changes.");
        } finally {
            setIsSmartAnalyzing(false);
        }
    };

    const handleVetIdeas = () => {
        if (!ready) return;
        if (filteredIdeas.length === 0) {
            alert("No ideas to vet!");
            return;
        }
        setVettingResults([]);
        setVettingRawOutput(null);
        setCurrentCriteria(null);
        setShowVettingModal(true);
    };

    const handleRunVetting = async (criteria: VettingCriteria) => {
        if (!ready) return;
        setAiError(null);
        try {
            setCurrentCriteria(criteria);
            setIsVetting(true);
            setVettingResults([]);
            setVettingRawOutput(null);


            const results = await aiService.vetIdeas(filteredIdeas, criteria);
            setVettingResults(results);

            // Persist results to DB
            const updates = results.map(async (result) => {
                const ideaToUpdate = ideas.find(i => i.id === result.ideaId);
                if (!ideaToUpdate) return;

                // Check if we need to update:
                // 1. If it's a new result (timestamp is strictly newer than what we have)
                // 2. OR if we don't have it at all
                await dbService.updateIdea(ideaToUpdate.id, { vettingMerge: [result] });
                return ideaToUpdate;
            });

            const updatedIdeas = (await Promise.all(updates)).filter(Boolean) as IdeaSummary[];

            if (updatedIdeas.length > 0) {
                setIdeas(prev => prev.map(idea => {
                    const updated = updatedIdeas.find(u => u.id === idea.id);
                    return updated || idea;
                }));
            }

        } catch (e) {
            if (isStructuredParseError(e)) {
                setVettingRawOutput(e.rawOutput);
            } else {
                console.error("Vetting failed:", e);
                setAiError((e as Error).message);
                // Don't close modal, let user retry or select other criteria
            }
        } finally {
            setIsVetting(false);
        }
    };

    const handleDeleteVettedIdea = async (ideaId: string) => {
        try {
            await dbService.deleteIdea(ideaId);
            setIdeas(prev => prev.filter(i => i.id !== ideaId));
            setVettingResults(prev => prev.filter(r => r.ideaId !== ideaId));
        } catch (e) {
            console.error("Failed to delete vetted idea:", e);
            alert("Failed to delete idea.");
        }
    };


    const validFolderIds = useMemo(() => new Set(folders.map(f => f.id)), [folders]);
    const normalizedSearchQuery = searchQuery.trim().toLowerCase();

    const filteredIdeas = useMemo(() => {
        return ideas
            .filter(idea => {
                const matchesSearch = !normalizedSearchQuery || (
                    idea.title + idea.details + (idea.keywords || []).join(' ')
                ).toLowerCase().includes(normalizedSearchQuery);
                const matchesStatus = statusFilter === 'all' || idea.status === statusFilter;
                const matchesFolder = () => {
                    if (selectedFolderId === 'all') return true;
                    if (selectedFolderId === 'uncategorized') {
                        // Match if no folder_id OR if folder_id doesn't exist in current folders list (orphan)
                        return !idea.folder_id || !validFolderIds.has(idea.folder_id);
                    }
                    return idea.folder_id === selectedFolderId;
                };

                return matchesSearch && matchesStatus && matchesFolder();
            })
            .sort((a, b) => {
                if (sortOption === 'newest') return b.timestamp - a.timestamp;
                if (sortOption === 'oldest') return a.timestamp - b.timestamp;
                if (sortOption === 'az') return a.title.localeCompare(b.title);
                return 0;
            });
    }, [ideas, normalizedSearchQuery, statusFilter, selectedFolderId, sortOption, validFolderIds]);

    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    // ... existing code ...

    return (
        <div className="flex w-full h-[calc(100vh-64px)] overflow-hidden relative">
            {/* Mobile Sidebar Overlay */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm"
                    onClick={() => setIsMobileMenuOpen(false)}
                />
            )}

            {/* Folder Sidebar - Responsive */}
            <FolderSidebar
                folders={folders}
                selectedFolderId={selectedFolderId}
                onSelectFolder={(id) => {
                    setSelectedFolderId(id);
                    setIsMobileMenuOpen(false);
                }}
                onCreateFolder={handleCreateFolder}
                onDeleteFolder={handleDeleteFolder}
                onSmartOrganize={handleSmartOrganize}
                aiDisabled={!ready}
                onDropIdea={handleDropIdea}
                className={`
                    shrink-0 border-r border-border transition-transform duration-300 ease-in-out
                    md:relative md:translate-x-0 md:flex
                    fixed inset-y-0 left-0 z-50 w-72 bg-background shadow-2xl
                    ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
                `}
            />

            {/* Main Content Area - Scrollable */}
            <div
                ref={mainContainerRef}
                data-testid="home-scroll-container"
                className="flex-1 overflow-y-auto h-full p-4 md:p-8 relative w-full"
                onDragOver={(e) => {
                    e.preventDefault();
                    handleAutoScroll(e);
                }}
            >
                <div className="max-w-6xl mx-auto w-full pb-20">
                    {aiError && <p role="alert" className="text-danger mb-4">{aiError}</p>}
                    {/* Hero Section */}
                    <div className="mb-10 text-center py-10">
                        <h2 className="text-4xl font-extrabold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-accent via-purple-500 to-indigo-600">
                            Your Idea Garden, <br />
                            Powered by AI.
                        </h2>
                        <p className="text-text-secondary text-lg max-w-2xl mx-auto mb-8">
                            Capture, analyze, and refine your next big thing. Let AI handle the heavy lifting while you focus on the vision.
                        </p>

                        <HomeChat />

                        <div className="flex justify-center gap-4 mt-8 opacity-80 hover:opacity-100 transition-opacity">
                            <span className="text-sm text-text-secondary uppercase tracking-wider font-bold my-auto">Or</span>
                            <button
                                className={`text-sm flex items-center gap-2 px-4 py-2 rounded-lg bg-surface border border-border hover:bg-accent/5 hover:border-accent hover:text-accent transition-all ${(analyzingMVP || filteredIdeas.length === 0) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer opacity-100'
                                    }`}
                                onClick={handleAnalyzeMVP}
                                disabled={!ready || analyzingMVP || filteredIdeas.length === 0}
                            >
                                <Sparkles size={16} className={analyzingMVP ? "dot-animate" : ""} />
                                {analyzingMVP ? 'Analyzing...' : 'Find Simplest MVP'}
                            </button>
                            <button
                                className={`text-sm flex items-center gap-2 px-4 py-2 rounded-lg bg-surface border border-border hover:bg-amber-500/10 hover:border-amber-500 hover:text-amber-500 transition-all ${(isVetting || filteredIdeas.length === 0) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer opacity-100'}`}
                                onClick={handleVetIdeas}
                                disabled={!ready || isVetting || filteredIdeas.length === 0}
                            >
                                <AlertTriangle size={16} className={isVetting ? "dot-animate" : ""} />
                                {isVetting ? 'Vetting...' : 'Vet Ideas'}
                            </button>
                            <button
                                className={`text-sm flex items-center gap-2 px-4 py-2 rounded-lg bg-surface border border-border hover:bg-accent/5 hover:border-accent hover:text-accent transition-all ${creatingIdea ? 'cursor-not-allowed opacity-60' : ''}`}
                                onClick={createNewIdea}
                                disabled={creatingIdea}
                            >
                                <Plus size={16} />
                                {creatingIdea ? 'Creating...' : 'New Idea'}
                            </button>
                        </div>
                    </div>

                    {/* Controls Bar */}
                    <div className="card mb-6 p-3 flex gap-4 flex-wrap items-center sticky top-0 z-10 bg-surface/95 backdrop-blur-sm border-border/50 shadow-sm">
                        <button
                            className="md:hidden p-2 -ml-2 text-text-secondary hover:text-primary"
                            onClick={() => setIsMobileMenuOpen(true)}
                        >
                            <Menu size={24} />
                        </button>

                        <div className="flex-1 min-w-[200px] flex items-center border border-border rounded-lg px-3 bg-background">
                            <Search size={18} className="text-text-secondary" />
                            <input
                                className="input border-none bg-transparent shadow-none"
                                placeholder="Search ideas..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        <div className="flex items-center gap-2">
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as any)}
                                className="input w-auto cursor-pointer"
                            >
                                <option value="all">All Statuses</option>
                                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                                    <option key={key} value={key}>{label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex items-center gap-2">
                            <select
                                value={sortOption}
                                onChange={(e) => setSortOption(e.target.value as any)}
                                className="input w-auto cursor-pointer"
                            >
                                <option value="newest">Newest First</option>
                                <option value="oldest">Oldest First</option>
                                <option value="az">A-Z</option>
                            </select>
                        </div>
                    </div>

                    {error && (
                        <div className="p-4 mb-6 bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-2xl border border-red-200 dark:border-red-800 flex items-center gap-3">
                            <div className="p-2 bg-red-200 dark:bg-red-800 rounded-full">!</div>
                            {error}
                        </div>
                    )}

                    {ideasLoading ? (
                        <div className="text-center p-16 text-text-secondary">Loading ideas...</div>
                    ) : filteredIdeas.length === 0 && !error ? (
                        <div className="text-center p-16 border-2 border-dashed border-border rounded-3xl bg-surface/50">
                            <div className="w-16 h-16 bg-accent/10 text-accent rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <Plus size={32} />
                            </div>
                            <h3 className="text-xl font-bold mb-2">
                                {ideas.length === 0 ? "No ideas yet?" : "No matching ideas"}
                            </h3>
                            <p className="text-text-secondary mb-6 max-w-md mx-auto">
                                {ideas.length === 0
                                    ? "Every great startup begins with a simple note. Click the \"New Idea\" button to plant your first seed."
                                    : "Try adjusting your search or filters to find what you're looking for, or check a different folder."}
                            </p>
                            {ideas.length === 0 && (
                                <button className="btn-primary" onClick={createNewIdea} disabled={creatingIdea}>
                                    {creatingIdea ? 'Creating...' : 'Create First Idea'}
                                </button>
                            )}
                        </div>
                    ) : (
                        <>
                            <VirtualIdeaBoard
                                ideas={filteredIdeas}
                                folders={folders}
                                selectedFolderId={selectedFolderId}
                                dragOverFolderId={dragOverFolderId}
                                scrollElementRef={mainContainerRef}
                                resetKey={`${searchQuery}|${statusFilter}|${selectedFolderId}|${sortOption}`}
                                onDragStart={handleDragStart}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleGroupDrop}
                                onAnalyzeViability={handleAnalyzeViability}
                                onMoveStart={handleMoveStart}
                                onDeleteIdea={handleDeleteIdea}
                                onNavigate={(ideaId) => navigate(`/idea/${ideaId}`)}
                            />
                        </>
                    )}

                    {!ideasLoading && nextCursor && (
                        <div className="flex justify-center mt-8">
                            <button className="btn-primary" onClick={loadMoreIdeas} disabled={loadingMore}>
                                {loadingMore ? 'Loading more...' : 'Load more ideas'}
                            </button>
                        </div>
                    )}

                    <MVPResultModal
                        isOpen={showMVPModal}
                        results={mvpResult}
                        rawOutput={mvpRawOutput}
                        ideas={ideas}
                        onClose={() => {
                            setShowMVPModal(false);
                            setMvpRawOutput(null);
                        }}
                    />

                    <BusinessViabilityModal
                        isOpen={showViabilityModal}
                        loading={viabilityLoading}
                        ideaTitle={viabilityIdeaTitle}
                        report={viabilityReport}
                        error={viabilityError}
                        onClose={() => setShowViabilityModal(false)}
                    />

                    <MoveToFolderModal
                        isOpen={showMoveModal}
                        onClose={() => setShowMoveModal(false)}
                        onMove={handleMoveComplete}
                        folders={folders}
                        currentFolderId={ideaToMove?.folder_id}
                    />

                    <SmartOrganizeModal
                        isOpen={showSmartOrganizeModal}
                        loading={isSmartAnalyzing}
                        suggestions={smartSuggestions}
                        rawOutput={smartOrganizeRawOutput}
                        ideas={ideas}
                        onClose={() => {
                            setShowSmartOrganizeModal(false);
                            setSmartOrganizeRawOutput(null);
                        }}
                        onApply={handleApplySmartOrganize}
                    />

                    <VettingModal
                        isOpen={showVettingModal}
                        loading={isVetting}
                        results={vettingResults}
                        rawOutput={vettingRawOutput}
                        ideas={ideas}
                        currentCriteria={currentCriteria}
                        onClose={() => {
                            setShowVettingModal(false);
                            setVettingRawOutput(null);
                        }}
                        onDelete={handleDeleteVettedIdea}
                        onRunVetting={handleRunVetting}
                        aiDisabled={!ready}
                    />

                    <ConfirmModal
                        isOpen={showDeleteModal}
                        title="Delete Idea"
                        message={`Are you sure you want to delete "${ideaToDelete?.title}"? This action cannot be undone.`}
                        onConfirm={confirmDeleteIdea}
                        onCancel={() => {
                            setShowDeleteModal(false);
                            setIdeaToDelete(null);
                        }}
                    />

                    {/* Floating indicator for background report generation */}
                    {!showViabilityModal && (viabilityLoading || viabilityReport) && (
                        <div
                            onClick={() => setShowViabilityModal(true)}
                            className={`fixed bottom-8 right-8 text-white px-6 py-4 rounded-2xl shadow-xl shadow-accent/20 cursor-pointer flex items-center gap-3 text-sm font-bold z-[999] transition-transform duration-200 hover:scale-105 hover:-translate-y-1 ${viabilityLoading ? 'bg-accent' : 'bg-success'}`}
                        >
                            {viabilityLoading ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    <div>
                                        <div className="text-xs opacity-80 uppercase tracking-wider">AI Agent</div>
                                        Generating Report...
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="p-1 bg-white/20 rounded-full">
                                        <Sparkles size={16} className="fill-current" />
                                    </div>
                                    <div>
                                        <div className="text-xs opacity-80 uppercase tracking-wider">Done</div>
                                        Report Ready!
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div >
    );
};
