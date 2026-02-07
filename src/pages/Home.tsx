import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Sparkles, Search, Trash2, FolderOutput, Folder as FolderIcon, LayoutGrid } from 'lucide-react';
import { dbService } from '../services/db';
import { aiService, MVPAnalysisResult } from '../services/ai';
import { Idea, IdeaStatus, STATUS_COLORS, STATUS_LABELS, Folder } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { MVPResultModal } from '../components/MVPResultModal';
import { BusinessViabilityModal } from '../components/BusinessViabilityModal';
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
    const [mvpResult, setMvpResult] = useState<MVPAnalysisResult | null>(null);
    const [showMVPModal, setShowMVPModal] = useState(false);

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

    const handleDeleteFolder = async (folderId: string) => {
        try {
            await dbService.deleteFolder(folderId);
            setFolders(prev => prev.filter(f => f.id !== folderId));
            if (selectedFolderId === folderId) {
                setSelectedFolderId('all');
            }
            // Update ideas in this folder to have no folderId (Uncategorized)
            // Note: In a real app, backend loop updates might be better, or batch update endpoint.
            // For now, let's just update local state. The backend JSON won't automatically unset folderId
            // unless we update each idea. But if the folder is gone, the ID is just an orphan reference.
            // For cleaner data, we could fetch and update all ideas in this folder, but avoiding N requests for now.
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
            relatedIdeaIds: [],
            status: 'draft',
            folderId: selectedFolderId !== 'all' ? selectedFolderId : undefined
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

    const handleMoveComplete = async (folderId?: string) => {
        if (!ideaToMove) return;

        try {
            const updatedIdea = { ...ideaToMove, folderId };
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
                const folderId = newFoldersMap.get(suggestion.name);
                if (!folderId) continue;

                for (const ideaId of suggestion.ideaIds) {
                    const ideaIndex = updatedIdeas.findIndex(i => i.id === ideaId);
                    if (ideaIndex !== -1) {
                        const updatedIdea = { ...updatedIdeas[ideaIndex], folderId };
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

    const getWinningIdeaTitle = () => {
        if (!mvpResult) return "";
        const idea = ideas.find(i => i.id === mvpResult.ideaId);
        return idea ? idea.title : "Unknown Idea";
    };

    // Filter and Sort Logic
    // Optimization: Create a Set of valid folder IDs for O(1) lookup
    const validFolderIds = new Set(folders.map(f => f.id));

    const filteredIdeas = ideas
        .filter(idea => {
            const matchesSearch = (idea.title + idea.details + idea.keywords.join(' ')).toLowerCase().includes(searchQuery.toLowerCase());
            const matchesStatus = statusFilter === 'all' || idea.status === statusFilter;
            const matchesFolder = () => {
                if (selectedFolderId === 'all') return true;
                if (selectedFolderId === 'uncategorized') {
                    // Match if no folderId OR if folderId doesn't exist in current folders list (orphan)
                    return !idea.folderId || !validFolderIds.has(idea.folderId);
                }
                return idea.folderId === selectedFolderId;
            };

            return matchesSearch && matchesStatus && matchesFolder();
        })
        .sort((a, b) => {
            if (sortOption === 'newest') return b.timestamp - a.timestamp;
            if (sortOption === 'oldest') return a.timestamp - b.timestamp;
            if (sortOption === 'az') return a.title.localeCompare(b.title);
            return 0;
        });

    return (
        <div className="flex w-full h-[calc(100vh-64px)] overflow-hidden">
            {/* Folder Sidebar - Fixed width */}
            <FolderSidebar
                folders={folders}
                selectedFolderId={selectedFolderId}
                onSelectFolder={setSelectedFolderId}
                onCreateFolder={handleCreateFolder}
                onDeleteFolder={handleDeleteFolder}
                onSmartOrganize={handleSmartOrganize}
                className="hidden md:flex shrink-0 border-r border-border"
            />

            {/* Main Content Area - Scrollable */}
            <div className="flex-1 overflow-y-auto h-full p-4 md:p-8 relative">
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
                                        className="card group relative flex flex-col h-full cursor-pointer overflow-hidden border-t-4 border-t-transparent hover:border-t-accent transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
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
                                            {idea.keywords.slice(0, 3).map((kw, idx) => (
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
                                        const fId = (idea.folderId && validFolderIds.has(idea.folderId)) ? idea.folderId : 'uncategorized';
                                        if (!groupedIdeas[fId]) groupedIdeas[fId] = [];
                                        groupedIdeas[fId].push(idea);
                                    });

                                    return (
                                        <div className="space-y-10">
                                            {/* Render Folders First */}
                                            {folders.map(folder => {
                                                const folderIdeas = groupedIdeas[folder.id];
                                                if (!folderIdeas || folderIdeas.length === 0) return null;
                                                return (
                                                    <div key={folder.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                                                        <div className="flex items-center gap-2 mb-4 text-text-secondary border-b border-border/50 pb-2">
                                                            <FolderIcon size={20} className="text-accent" />
                                                            <h3 className="text-xl font-bold text-text-primary">{folder.name}</h3>
                                                            <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-bold">
                                                                {folderIdeas.length}
                                                            </span>
                                                        </div>
                                                        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6 w-full px-1">
                                                            {folderIdeas.map(renderIdeaCard)}
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {/* Render Uncategorized */}
                                            {groupedIdeas['uncategorized'] && groupedIdeas['uncategorized'].length > 0 && (
                                                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
                                                    <div className="flex items-center gap-2 mb-4 text-text-secondary border-b border-border/50 pb-2">
                                                        <LayoutGrid size={20} />
                                                        <h3 className="text-xl font-bold text-text-primary">Uncategorized</h3>
                                                        <span className="text-xs bg-text-secondary/10 text-text-secondary px-2 py-0.5 rounded-full font-bold">
                                                            {groupedIdeas['uncategorized'].length}
                                                        </span>
                                                    </div>
                                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6 w-full px-1">
                                                        {groupedIdeas['uncategorized'].map(renderIdeaCard)}
                                                    </div>
                                                </div>
                                            )}
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
                        title={getWinningIdeaTitle()}
                        reason={mvpResult?.reason || ""}
                        ideaId={mvpResult?.ideaId || ""}
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
                        currentFolderId={ideaToMove?.folderId}
                    />

                    <SmartOrganizeModal
                        isOpen={showSmartOrganizeModal}
                        loading={isSmartAnalyzing}
                        suggestions={smartSuggestions}
                        ideas={ideas}
                        onClose={() => setShowSmartOrganizeModal(false)}
                        onApply={handleApplySmartOrganize}
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
        </div>
    );
};
