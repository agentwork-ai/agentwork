'use client';

import { useEffect, useState, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import BottomBar from '@/components/BottomBar';
import CodeViewer from '@/components/CodeViewer';
import { api } from '@/lib/api';
import { useSocket } from '@/app/providers';
import {
  Plus, FolderOpen, Trash2, Edit2, ChevronRight, ChevronDown,
  FileText, Folder, X, Search, RefreshCw, Pencil, Save,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function ProjectsPage() {
  const socket = useSocket();
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editProject, setEditProject] = useState(null);
  const [fileTree, setFileTree] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchContent, setSearchContent] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const data = await api.getProjects();
      setProjects(data);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!socket) return;
    const handlers = {
      'project:created': () => loadProjects(),
      'project:updated': () => loadProjects(),
      'project:deleted': ({ id }) => {
        setProjects((prev) => prev.filter((p) => p.id !== id));
        if (selected?.id === id) { setSelected(null); setFileTree(null); }
      },
    };
    Object.entries(handlers).forEach(([e, h]) => socket.on(e, h));
    return () => Object.entries(handlers).forEach(([e, h]) => socket.off(e, h));
  }, [socket, selected, loadProjects]);

  const selectProject = async (project) => {
    setSelected(project);
    setFileContent(null);
    setSearchQuery('');
    setSearchResults(null);
    try {
      const tree = await api.getProjectFiles(project.id, 4);
      setFileTree(tree);
    } catch { setFileTree([]); }
  };

  const deleteProject = async (id) => {
    if (!confirm('Delete this project?')) return;
    await api.deleteProject(id);
    toast.success('Project deleted');
  };

  const openFile = async (path) => {
    try {
      const data = await api.readFile(path);
      setFileContent({ path, ...data });
      setEditMode(false);
      setEditContent('');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleSearch = async (e) => {
    if (e.key !== 'Enter' || !searchQuery.trim() || !selected) return;
    setSearching(true);
    try {
      const results = await api.searchProjectFiles(selected.id, searchQuery.trim(), searchContent);
      setSearchResults(results);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <main className="flex-1 overflow-hidden flex" style={{ background: 'var(--bg-primary)' }}>
          {/* Projects list */}
          <div className="w-72 border-r flex flex-col shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
            <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Projects</h2>
              <button className="btn btn-primary text-xs py-1.5 px-3" onClick={() => { setShowForm(true); setEditProject(null); }}>
                <Plus size={14} /> New
              </button>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-1">
              {loading ? (
                <p className="text-center text-sm py-8" style={{ color: 'var(--text-tertiary)' }}>Loading...</p>
              ) : projects.length === 0 ? (
                <p className="text-center text-sm py-8" style={{ color: 'var(--text-tertiary)' }}>No projects yet</p>
              ) : projects.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors group"
                  style={{
                    background: selected?.id === p.id ? 'var(--accent-light)' : 'transparent',
                    color: selected?.id === p.id ? 'var(--accent)' : 'var(--text-primary)',
                  }}
                  onClick={() => selectProject(p)}
                >
                  <FolderOpen size={18} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>{p.path}</p>
                  </div>
                  <div className="hidden group-hover:flex gap-1">
                    <button onClick={(e) => { e.stopPropagation(); setEditProject(p); setShowForm(true); }}
                      className="p-1 rounded hover:bg-black/10"><Edit2 size={13} /></button>
                    <button onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}
                      className="p-1 rounded hover:bg-black/10" style={{ color: 'var(--danger)' }}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* File Explorer & Content */}
          <div className="flex-1 flex min-w-0">
            {selected ? (
              <>
                {/* File tree */}
                <div className="w-64 border-r flex flex-col shrink-0" style={{ borderColor: 'var(--border)' }}>
                  <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                    <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>File Explorer</span>
                    <div className="flex gap-1">
                      <button onClick={async () => {
                        try { await api.regenerateProjectDoc(selected.id); toast.success('PROJECT.md regenerated'); selectProject(selected); } catch (err) { toast.error(err.message); }
                      }} className="p-1 rounded text-xs" style={{ color: 'var(--text-tertiary)' }} title="Regenerate PROJECT.md">
                        <FileText size={13} />
                      </button>
                      <button onClick={() => selectProject(selected)} className="p-1 rounded" style={{ color: 'var(--text-tertiary)' }} title="Refresh">
                        <RefreshCw size={13} />
                      </button>
                    </div>
                  </div>
                  {/* Search input */}
                  <div className="p-2 border-b" style={{ borderColor: 'var(--border)' }}>
                    <div className="relative">
                      <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
                      <input
                        className="input text-xs pl-7 pr-7 py-1.5"
                        placeholder="Search files... (Enter)"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={handleSearch}
                      />
                      {searchResults !== null && (
                        <button
                          className="absolute right-2 top-1/2 -translate-y-1/2"
                          style={{ color: 'var(--text-tertiary)' }}
                          onClick={clearSearch}
                          title="Clear search"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={searchContent}
                        onChange={(e) => setSearchContent(e.target.checked)}
                        className="rounded"
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Search file contents</span>
                    </label>
                  </div>
                  <div className="flex-1 overflow-auto p-2">
                    {searching ? (
                      <p className="text-xs text-center py-4" style={{ color: 'var(--text-tertiary)' }}>Searching...</p>
                    ) : searchResults !== null ? (
                      searchResults.length === 0 ? (
                        <p className="text-xs text-center py-4" style={{ color: 'var(--text-tertiary)' }}>No results found</p>
                      ) : (
                        <div className="space-y-0.5">
                          <p className="text-[10px] px-1 mb-1" style={{ color: 'var(--text-tertiary)' }}>
                            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                          </p>
                          {searchResults.map((r) => (
                            <button
                              key={r.path}
                              className="flex flex-col gap-0.5 py-1.5 px-2 rounded text-xs w-full text-left hover:opacity-80 transition-colors"
                              style={{ color: 'var(--text-secondary)' }}
                              onClick={() => {
                                if (r.type === 'file') openFile(r.path);
                              }}
                              title={r.path}
                            >
                              <div className="flex items-center gap-1.5">
                                {r.type === 'directory' ? (
                                  <Folder size={12} className="shrink-0" style={{ color: 'var(--accent)' }} />
                                ) : (
                                  <FileText size={12} className="shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                                )}
                                <span className="truncate">{r.relativePath}</span>
                                {r.match === 'content' && (
                                  <span className="shrink-0 text-[9px] px-1 rounded" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>content</span>
                                )}
                              </div>
                              {r.snippet && (
                                <span className="text-[10px] truncate pl-5 block" style={{ color: 'var(--text-tertiary)' }}>{r.snippet}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )
                    ) : fileTree ? (
                      fileTree.map((node) => <FileNode key={node.path} node={node} onOpen={openFile} />)
                    ) : (
                      <p className="text-xs text-center py-4" style={{ color: 'var(--text-tertiary)' }}>Loading...</p>
                    )}
                  </div>
                </div>

                {/* File content */}
                <div className="flex-1 flex flex-col min-w-0">
                  {fileContent ? (
                    <>
                      <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                        <span className="text-xs font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{fileContent.path}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {editMode ? (
                            <>
                              <button
                                onClick={async () => {
                                  setSaving(true);
                                  try {
                                    await api.writeFile(fileContent.path, editContent);
                                    setFileContent({ ...fileContent, content: editContent });
                                    setEditMode(false);
                                    toast.success('File saved');
                                  } catch (err) {
                                    toast.error('Save failed: ' + err.message);
                                  } finally {
                                    setSaving(false);
                                  }
                                }}
                                disabled={saving}
                                className="flex items-center gap-1 text-xs py-1 px-2.5 rounded font-medium transition-colors"
                                style={{ background: 'var(--accent)', color: 'white', opacity: saving ? 0.6 : 1 }}
                              >
                                <Save size={12} />
                                {saving ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                onClick={() => { setEditMode(false); setEditContent(''); }}
                                className="flex items-center gap-1 text-xs py-1 px-2.5 rounded font-medium transition-colors"
                                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => { setEditMode(true); setEditContent(fileContent.content); }}
                              className="flex items-center gap-1 text-xs py-1 px-2 rounded transition-colors"
                              style={{ color: 'var(--text-tertiary)' }}
                              title="Edit file"
                            >
                              <Pencil size={12} />
                              Edit
                            </button>
                          )}
                          <button onClick={() => { setFileContent(null); setEditMode(false); setEditContent(''); }} className="p-1 rounded" style={{ color: 'var(--text-tertiary)' }}>
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                      {editMode ? (
                        <div className="flex-1 flex min-h-0" style={{ background: 'var(--bg-secondary)' }}>
                          <div className="py-4 pl-3 pr-1 text-right select-none" style={{ color: 'var(--text-tertiary)', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.625' }}>
                            {editContent.split('\n').map((_, i) => (
                              <div key={i}>{i + 1}</div>
                            ))}
                          </div>
                          <textarea
                            className="flex-1 p-4 pl-2 text-xs leading-relaxed font-mono resize-none outline-none border-none min-h-0"
                            style={{
                              color: 'var(--text-primary)',
                              background: 'var(--bg-secondary)',
                              tabSize: 2,
                              caretColor: 'var(--accent)',
                            }}
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            spellCheck={false}
                            autoFocus
                          />
                        </div>
                      ) : (
                        <div className="flex-1 overflow-hidden">
                          <CodeViewer content={fileContent.content} path={fileContent.path} />
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Select a file to view its contents</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <FolderOpen size={48} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Select a project or create a new one</p>
                </div>
              </div>
            )}
          </div>
        </main>
        <BottomBar />
      </div>

      {/* Project form modal */}
      {showForm && (
        <ProjectFormModal
          project={editProject}
          onClose={() => { setShowForm(false); setEditProject(null); }}
          onSaved={() => { setShowForm(false); setEditProject(null); loadProjects(); }}
        />
      )}
    </div>
  );
}

function FileNode({ node, onOpen, depth = 0 }) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (node.type === 'file') {
    return (
      <button
        className="flex items-center gap-1.5 py-1 px-2 rounded text-xs w-full text-left hover:opacity-80 transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px`, color: 'var(--text-secondary)' }}
        onClick={() => onOpen(node.path)}
      >
        <FileText size={13} className="shrink-0" style={{ color: 'var(--text-tertiary)' }} />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        className="flex items-center gap-1.5 py-1 px-2 rounded text-xs w-full text-left hover:opacity-80 font-medium transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px`, color: 'var(--text-primary)' }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Folder size={13} style={{ color: 'var(--accent)' }} />
        <span className="truncate">{node.name}</span>
      </button>
      {expanded && node.children?.map((child) => (
        <FileNode key={child.path} node={child} onOpen={onOpen} depth={depth + 1} />
      ))}
    </div>
  );
}

function ProjectFormModal({ project, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: project?.name || '',
    description: project?.description || '',
    path: project?.path || '',
    ignore_patterns: project?.ignore_patterns || 'node_modules,.git,dist,build,.next',
    default_agent_id: project?.default_agent_id || '',
  });
  const [saving, setSaving] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [agents, setAgents] = useState([]);

  useEffect(() => {
    api.getAgents().then(setAgents).catch(() => {});
  }, []);

  const handleBrowse = async () => {
    setBrowsing(true);
    try {
      const result = await api.browseFolder();
      if (result.path) {
        const folderPath = result.path.replace(/\/$/, '');
        const folderName = folderPath.split('/').pop();
        setForm((f) => ({
          ...f,
          path: folderPath,
          name: f.name || folderName,
        }));
      }
    } catch (err) {
      toast.error('Could not open folder picker: ' + err.message);
    } finally {
      setBrowsing(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (project) {
        await api.updateProject(project.id, form);
        toast.success('Project updated');
      } else {
        await api.createProject(form);
        toast.success('Project created');
      }
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="card p-6 w-full max-w-md animate-fade-in" style={{ background: 'var(--bg-elevated)' }}>
        <h3 className="font-semibold text-lg mb-4" style={{ color: 'var(--text-primary)' }}>
          {project ? 'Edit Project' : 'New Project'}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="label">Local Path</label>
            <div className="flex gap-2">
              <input className="input font-mono text-sm flex-1" value={form.path}
                onChange={(e) => setForm({ ...form, path: e.target.value })} placeholder="/Users/you/projects/myapp" required />
              <button type="button" className="btn btn-secondary shrink-0 flex items-center gap-1.5"
                onClick={handleBrowse} disabled={browsing}>
                <FolderOpen size={14} />
                {browsing ? '...' : 'Browse'}
              </button>
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          </div>
          <div>
            <label className="label">Default Agent</label>
            <select className="input" value={form.default_agent_id}
              onChange={(e) => setForm({ ...form, default_agent_id: e.target.value })}>
              <option value="">None</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.avatar} {a.name} — {a.role}</option>
              ))}
            </select>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Auto-assign this agent to new tasks for this project</p>
          </div>
          <div>
            <label className="label">Ignore Patterns (comma-separated)</label>
            <input className="input text-sm" value={form.ignore_patterns}
              onChange={(e) => setForm({ ...form, ignore_patterns: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : project ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
