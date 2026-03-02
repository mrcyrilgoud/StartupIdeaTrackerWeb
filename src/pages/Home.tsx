import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Sparkles, Search, Trash2, FolderOutput, LayoutGrid, Folder as FolderIcon, Menu, AlertTriangle } from 'lucide-react';
import { dbService } from '../services/db';
import { aiService, MVPAnalysisResult } from '../services/ai';
import { Idea, IdeaStatus, STATUS_COLORS, STATUS_LABELS, Folder, VettingResult, VettingCriteria } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { MVPResultModal } from '../components/MVPResultModal';
import { BusinessViabilityModal } from '../components/BusinessViabilityModal';
import { VettingModal } from '../components/VettingModal';
import { HomeChat } from '../components/features/HomeChat';
import { FolderSidebar } from '../components/features/FolderSidebar';
import { MoveToFolderModal } from '../components/MoveToFolderModal';
import { SmartOrganizeModal } from '../components/SmartOrganizeModal';
import { ConfirmModal } from '../components/ConfirmModal';

export const Home: React.FC = () => {
    const [ideas, setIdeas] = useState<Idea[]>([]);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [selectedFolderId, setSelectedFolderId] = useState<string>('all');

    const [error, setError] = useState<string | null>(null);
    const [analyzingMVP, setAnalyzingMVP] = useState(false);
    const [mvpResult, setMvpResult] = useState<MVPAnalysisResult[] | null>(null);
    const [showMVPModal, setShowMVPModal] = useState(false);

    // Vetting state
    const [isVetting, setIsVetting] = useState(false);
    const [vettingResults, setVettingResults] = useState<VettingResult[]>([]);
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
    const [ideaToDelete, setIdeaToDelete] = useState<Idea | null>(null);

    // Move Idea state
    const [showMoveModal, setShowMoveModal] = useState(false);
    const [ideaToMove, setIdeaToMove] = useState<Idea | null>(null);

    // Smart Organize state
    const [showSmartOrganizeModal, setShowSmartOrganizeModal] = useState(false);
    const [smartSuggestions, setSmartSuggestions] = useState<any[]>([]);
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

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setError(null);
            const [loadedIdeas, loadedFolders] = await Promise.all([
                dbService.getAllIdeas(),
                dbService.getAllFolders()
            ]);

            // Ensure status exists for backward compatibility
            const cleanedIdeas = loadedIdeas.map(i => ({
                ...i,
                status: i.status || 'draft'
            }));

            setIdeas(cleanedIdeas);
            setFolders(loadedFolders);
        } catch (e) {
            setError("Could not connect to the database. Make sure 'npm run dev' is running.");
        }
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
                    const updated = { ...idea, folder_id: undefined };
                    return dbService.saveIdea(updated);
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
        // We pass the new object in state so Detail page can load it without DB
        navigate(`/idea/${newIdea.id}`, { state: { idea: newIdea, isNew: true } });
    };

    const handleAnalyzeViability = async (e: React.MouseEvent, idea: Idea) => {
        e.preventDefault(); // Prevent navigation to detail page
        e.stopPropagation();

        try {
            setViabilityIdeaTitle(idea.title);
            setViabilityReport('');
            setViabilityError(null);
            setShowViabilityModal(true);
            setViabilityLoading(true);

            const settings = await dbService.getSettings();

            if (settings.provider === 'gemini' && !settings.geminiKey) {
                setViabilityLoading(false);
                setViabilityError("Please configure your Gemini API Key in Settings first.");
                return;
            }

            const report = await aiService.generateViabilityReport(idea, settings);
            setViabilityReport(report);
        } catch (e) {
            console.error(e);
            setViabilityError(`Error generating report: ${(e as Error).message}`);
        } finally {
            setViabilityLoading(false);
        }
    };

    const handleAnalyzeMVP = async () => {
        if (filteredIdeas.length === 0) {
            alert("No ideas to analyze in this view!");
            return;
        }

        try {
            setAnalyzingMVP(true);
            const settings = await dbService.getSettings();

            // Check if key is configured for Gemini (default)
            if (settings.provider === 'gemini' && !settings.geminiKey) {
                alert("Please configure your Gemini API Key in Settings first.");
                setAnalyzingMVP(false);
                return;
            }

            const result = await aiService.findSimplestMVP(filteredIdeas, settings);
            setMvpResult(result);
            setShowMVPModal(true);
        } catch (e) {
            console.error(e);
            alert("Failed to analyze MVP. Please check your AI settings and try again.");
        } finally {
            setAnalyzingMVP(false);
        }
    };

    const handleDeleteIdea = (e: React.MouseEvent, idea: Idea) => {
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

    const handleMoveStart = (e: React.MouseEvent, idea: Idea) => {
        e.preventDefault();
        e.stopPropagation();
        setIdeaToMove(idea);
        setShowMoveModal(true);
    };

    const handleMoveComplete = async (folder_id?: string) => {
        if (!ideaToMove) return;

        try {
            const updatedIdea = { ...ideaToMove, folder_id };
            await dbService.saveIdea(updatedIdea);

            // Update local state
            setIdeas(prev => prev.map(i => i.id === ideaToMove.id ? updatedIdea : i));

            setShowMoveModal(false);
            setIdeaToMove(null);
        } catch (e) {
            console.error('Failed to move idea:', e);
            alert('Failed to move idea');
        }
    };

    const handleDragStart = (e: React.DragEvent, idea: Idea) => {
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
        dbService.saveIdea(updatedIdea).catch(e => {
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
        try {
            setShowSmartOrganizeModal(true);
            setIsSmartAnalyzing(true);
            setSmartSuggestions([]);

            const settings = await dbService.getSettings();

            // Check if key is configured for Gemini (default)
            if (settings.provider === 'gemini' && !settings.geminiKey) {
                alert("Please configure your Gemini API Key in Settings first.");
                setShowSmartOrganizeModal(false);
                setIsSmartAnalyzing(false);
                return;
            }

            const suggestions = await aiService.suggestFolders(ideas, folders, settings);
            setSmartSuggestions(suggestions);
        } catch (e) {
            console.error("Smart Organize failed:", e);
            alert("Failed to generate suggestions. Please check your AI settings.");
            setShowSmartOrganizeModal(false);
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
                        updatePromises.push(dbService.saveIdea(updatedIdea));
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
        if (filteredIdeas.length === 0) {
            alert("No ideas to vet!");
            return;
        }
        setVettingResults([]);
        setCurrentCriteria(null);
        setShowVettingModal(true);
    };

    const handleRunVetting = async (criteria: VettingCriteria) => {
        try {
            setCurrentCriteria(criteria);
            setIsVetting(true);
            setVettingResults([]);

            const settings = await dbService.getSettings();
            if (settings.provider === 'gemini' && !settings.geminiKey) {
                alert("Please configure your Gemini API Key in Settings first.");
                setIsVetting(false);
                return;
            }

            const results = await aiService.vetIdeas(filteredIdeas, criteria, settings);
            setVettingResults(results);

            // Persist results to DB
            const updates = results.map(async (result) => {
                const ideaToUpdate = ideas.find(i => i.id === result.ideaId);
                if (!ideaToUpdate) return;

                // Check if we need to update:
                // 1. If it's a new result (timestamp is strictly newer than what we have)
                // 2. OR if we don't have it at all
                const currentVetting = ideaToUpdate.vetting?.[criteria];
                if (!currentVetting || result.timestamp > currentVetting.timestamp) {
                    const updatedIdea = {
                        ...ideaToUpdate,
                        vetting: {
                            ...ideaToUpdate.vetting,
                            [criteria]: result
                        }
                    };
                    await dbService.saveIdea(updatedIdea);
                    return updatedIdea;
                }
            });

            const updatedIdeas = (await Promise.all(updates)).filter(Boolean) as Idea[];

            if (updatedIdeas.length > 0) {
                setIdeas(prev => prev.map(idea => {
                    const updated = updatedIdeas.find(u => u.id === idea.id);
                    return updated || idea;
                }));
            }

        } catch (e) {
            console.error("Vetting failed:", e);
            alert("Failed to vet ideas. Please check your AI settings.");
            // Don't close modal, let user retry or select other criteria
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


    // Filter and Sort Logic
    // Optimization: Create a Set of valid folder IDs for O(1) lookup
    const validFolderIds = new Set(folders.map(f => f.id));

    const filteredIdeas = ideas
        .filter(idea => {
            const matchesSearch = (idea.title + idea.details + (idea.keywords || []).join(' ')).toLowerCase().includes(searchQuery.toLowerCase());
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
                className="flex-1 overflow-y-auto h-full p-4 md:p-8 relative w-full"
                onDragOver={(e) => {
                    e.preventDefault();
                    handleAutoScroll(e);
                }}
            >
                <div className="max-w-6xl mx-auto w-full pb-20">
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
                                disabled={analyzingMVP || filteredIdeas.length === 0}
                            >
                                <Sparkles size={16} className={analyzingMVP ? "dot-animate" : ""} />
                                {analyzingMVP ? 'Analyzing...' : 'Find Simplest MVP'}
                            </button>
                            <button
                                className={`text-sm flex items-center gap-2 px-4 py-2 rounded-lg bg-surface border border-border hover:bg-amber-500/10 hover:border-amber-500 hover:text-amber-500 transition-all ${(isVetting || filteredIdeas.length === 0) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer opacity-100'}`}
                                onClick={handleVetIdeas}
                                disabled={isVetting || filteredIdeas.length === 0}
                            >
                                <AlertTriangle size={16} className={isVetting ? "dot-animate" : ""} />
                                {isVetting ? 'Vetting...' : 'Vet Ideas'}
                            </button>
                            <button
                                className="text-sm flex items-center gap-2 px-4 py-2 rounded-lg bg-surface border border-border hover:bg-accent/5 hover:border-accent hover:text-accent transition-all"
                                onClick={createNewIdea}
                            >
                                <Plus size={16} />
                                New Idea
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

                    {filteredIdeas.length === 0 && !error ? (
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
                                <button className="btn-primary" onClick={createNewIdea}>
                                    Create First Idea
                                </button>
                            )}
                        </div>
                    ) : (
                        <>
                            {(() => {
                                const renderIdeaCard = (idea: Idea) => (
                                    <div
                                        key={idea.id}
                                        draggable={true}
                                        onDragStart={(e) => handleDragStart(e, idea)}
                                        className="card group relative flex flex-col h-full cursor-pointer overflow-hidden border-t-4 border-t-transparent hover:border-t-accent transition-all duration-200 hover:-translate-y-1 hover:shadow-lg active:cursor-grabbing"
                                        onClick={(e) => {
                                            if ((e.target as HTMLElement).closest('button')) return;
                                            navigate(`/idea/${idea.id}`);
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
                                            {(idea.keywords || []).slice(0, 3).map((kw, idx) => (
                                                <span key={idx} className="text-[10px] font-bold uppercase tracking-wider bg-accent/5 text-accent px-2 py-1 rounded-md border border-accent/10">
                                                    {kw}
                                                </span>
                                            ))}
                                        </div>

                                        <div className="mt-auto pt-4 border-t border-border/50 flex gap-2" onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={(e) => handleAnalyzeViability(e, idea)}
                                                className="flex-1 btn-text text-xs justify-center bg-background hover:bg-accent hover:text-white border border-border/50"
                                            >
                                                <Search size={14} /> Viability
                                            </button>
                                            <button
                                                onClick={(e) => handleMoveStart(e, idea)}
                                                className="btn-icon p-1.5 text-text-secondary hover:text-accent hover:bg-accent/10 rounded-lg transition-colors"
                                                title="Move to Folder"
                                            >
                                                <FolderOutput size={16} />
                                            </button>
                                            <button
                                                onClick={(e) => handleDeleteIdea(e, idea)}
                                                className="btn-icon p-1.5 text-text-secondary hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
                                                title="Delete this idea"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                );

                                if (selectedFolderId === 'all') {
                                    // Group ideas logic
                                    const groupedIdeas: Record<string, Idea[]> = {};
                                    filteredIdeas.forEach(idea => {
                                        const fId = (idea.folder_id && validFolderIds.has(idea.folder_id)) ? idea.folder_id : 'uncategorized';
                                        if (!groupedIdeas[fId]) groupedIdeas[fId] = [];
                                        groupedIdeas[fId].push(idea);
                                    });

                                    return (
                                        <div className="space-y-10">
                                            {/* Render Folders First */}
                                            {folders.map(folder => {
                                                const folder_ideas = groupedIdeas[folder.id];
                                                const isDragOver = dragOverFolderId === folder.id;

                                                if ((!folder_ideas || folder_ideas.length === 0) && !isDragOver) return null;

                                                return (
                                                    <div
                                                        key={folder.id}
                                                        className={`animate-in fade-in slide-in-from-bottom-4 duration-500 rounded-xl transition-all ${isDragOver ? 'bg-accent/5 ring-2 ring-accent ring-inset p-4' : ''}`}
                                                        onDragOver={(e) => handleDragOver(e, folder.id)}
                                                        onDragLeave={handleDragLeave}
                                                        onDrop={(e) => handleGroupDrop(e, folder.id)}
                                                    >
                                                        <div className="flex items-center gap-2 mb-4 text-text-secondary border-b border-border/50 pb-2">
                                                            <FolderIcon size={20} className={isDragOver ? "text-accent" : "text-accent"} />
                                                            <h3 className="text-xl font-bold text-text-primary">{folder.name}</h3>
                                                            <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-bold">
                                                                {folder_ideas ? folder_ideas.length : 0}
                                                            </span>
                                                            {isDragOver && (
                                                                <span className="ml-auto text-xs text-accent font-bold animate-pulse">
                                                                    Drop to move here
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6 w-full px-1">
                                                            {folder_ideas && folder_ideas.map(renderIdeaCard)}
                                                            {isDragOver && (!folder_ideas || folder_ideas.length === 0) && (
                                                                <div className="h-32 border-2 border-dashed border-accent/30 rounded-lg flex items-center justify-center text-accent/50 text-sm">
                                                                    Drop idea here
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {/* Render Uncategorized */}
                                            {(groupedIdeas['uncategorized'] && groupedIdeas['uncategorized'].length > 0) || dragOverFolderId === 'uncategorized' ? (
                                                <div
                                                    className={`animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100 rounded-xl transition-all ${dragOverFolderId === 'uncategorized' ? 'bg-accent/5 ring-2 ring-accent ring-inset p-4' : ''}`}
                                                    onDragOver={(e) => handleDragOver(e, 'uncategorized')}
                                                    onDragLeave={handleDragLeave}
                                                    onDrop={(e) => handleGroupDrop(e, 'uncategorized')}
                                                >
                                                    <div className="flex items-center gap-2 mb-4 text-text-secondary border-b border-border/50 pb-2">
                                                        <LayoutGrid size={20} />
                                                        <h3 className="text-xl font-bold text-text-primary">Uncategorized</h3>
                                                        <span className="text-xs bg-text-secondary/10 text-text-secondary px-2 py-0.5 rounded-full font-bold">
                                                            {groupedIdeas['uncategorized'] ? groupedIdeas['uncategorized'].length : 0}
                                                        </span>
                                                        {dragOverFolderId === 'uncategorized' && (
                                                            <span className="ml-auto text-xs text-accent font-bold animate-pulse">
                                                                Drop to remove from folder
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6 w-full px-1">
                                                        {groupedIdeas['uncategorized'] && groupedIdeas['uncategorized'].map(renderIdeaCard)}
                                                        {dragOverFolderId === 'uncategorized' && (!groupedIdeas['uncategorized'] || groupedIdeas['uncategorized'].length === 0) && (
                                                            <div className="h-32 border-2 border-dashed border-accent/30 rounded-lg flex items-center justify-center text-accent/50 text-sm">
                                                                Drop idea here
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    );
                                }

                                // Default Grid View
                                return (
                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6 w-full">
                                        {filteredIdeas.map(renderIdeaCard)}
                                    </div>
                                );
                            })()}
                        </>
                    )}

                    <MVPResultModal
                        isOpen={showMVPModal}
                        results={mvpResult}
                        ideas={ideas}
                        onClose={() => setShowMVPModal(false)}
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
                        ideas={ideas}
                        onClose={() => setShowSmartOrganizeModal(false)}
                        onApply={handleApplySmartOrganize}
                    />

                    <VettingModal
                        isOpen={showVettingModal}
                        loading={isVetting}
                        results={vettingResults}
                        ideas={ideas}
                        currentCriteria={currentCriteria}
                        onClose={() => setShowVettingModal(false)}
                        onDelete={handleDeleteVettedIdea}
                        onRunVetting={handleRunVetting}
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
