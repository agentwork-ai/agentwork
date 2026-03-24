'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import Sidebar from '../../components/Sidebar';
import BottomBar from '../../components/BottomBar';
import { api } from '../../lib/api';
import {
  Plus, Save, Play, Trash2, X, ChevronDown,
  GitBranch, GripVertical, ArrowRight, List,
  Edit2, Copy, MoreHorizontal, AlertCircle,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

// ─── Constants ───
const NODE_W = 240;
const NODE_H = 140;
const GRID_SIZE = 20;
const CONNECTOR_RADIUS = 6;

function snapToGrid(v) {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── SVG Connection Lines ───
function ConnectionLines({ steps, draggingConnection, mousePos, canvasOffset }) {
  const lines = [];

  for (const step of steps) {
    if (!Array.isArray(step.next)) continue;
    for (const nextId of step.next) {
      const target = steps.find((s) => s.id === nextId);
      if (!target) continue;

      const x1 = step.x + NODE_W / 2;
      const y1 = step.y + NODE_H;
      const x2 = target.x + NODE_W / 2;
      const y2 = target.y;

      const midY = (y1 + y2) / 2;

      lines.push(
        <g key={`${step.id}-${nextId}`}>
          <path
            d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeDasharray="none"
            opacity="0.6"
          />
          {/* Arrowhead */}
          <polygon
            points={`${x2 - 5},${y2 - 8} ${x2 + 5},${y2 - 8} ${x2},${y2}`}
            fill="var(--accent)"
            opacity="0.6"
          />
        </g>
      );
    }
  }

  // Dragging connection preview
  if (draggingConnection && mousePos) {
    const source = steps.find((s) => s.id === draggingConnection);
    if (source) {
      const x1 = source.x + NODE_W / 2;
      const y1 = source.y + NODE_H;
      const x2 = mousePos.x - canvasOffset.x;
      const y2 = mousePos.y - canvasOffset.y;
      const midY = (y1 + y2) / 2;

      lines.push(
        <path
          key="dragging"
          d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeDasharray="6 3"
          opacity="0.4"
        />
      );
    }
  }

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0, overflow: 'visible' }}
    >
      {lines}
    </svg>
  );
}

// ─── Step Node ───
function StepNode({
  step,
  agents,
  selected,
  onSelect,
  onUpdate,
  onDelete,
  onConnectStart,
  onConnectEnd,
  onDragStart,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const agent = agents.find((a) => a.id === step.agent_id);

  return (
    <div
      className={`absolute rounded-lg border-2 shadow-md select-none transition-shadow ${
        selected ? 'ring-2' : ''
      }`}
      style={{
        left: step.x,
        top: step.y,
        width: NODE_W,
        height: NODE_H,
        background: 'var(--bg-elevated)',
        borderColor: selected ? 'var(--accent)' : 'var(--border)',
        ringColor: 'var(--accent)',
        zIndex: selected ? 10 : 1,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(step.id);
      }}
    >
      {/* Drag handle / header */}
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-t-md cursor-grab active:cursor-grabbing"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onDragStart(step.id, e);
        }}
      >
        <GripVertical size={14} style={{ color: 'var(--text-tertiary)' }} />
        {isEditing ? (
          <input
            className="flex-1 text-xs font-semibold bg-transparent outline-none"
            style={{ color: 'var(--text-primary)' }}
            value={step.title}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onUpdate(step.id, { title: e.target.value })}
            onBlur={() => setIsEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setIsEditing(false);
            }}
          />
        ) : (
          <span
            className="flex-1 text-xs font-semibold truncate"
            style={{ color: 'var(--text-primary)' }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            {step.title || 'Untitled Step'}
          </span>
        )}
        <button
          className="p-0.5 rounded hover:bg-red-500/20"
          style={{ color: 'var(--text-tertiary)' }}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(step.id);
          }}
          title="Delete step"
        >
          <X size={12} />
        </button>
      </div>

      {/* Body */}
      <div className="px-2 py-1.5 space-y-1 overflow-hidden" style={{ height: NODE_H - 38 }}>
        {/* Agent dropdown */}
        <select
          className="w-full text-[11px] px-1.5 py-0.5 rounded border bg-transparent truncate"
          style={{
            color: 'var(--text-secondary)',
            borderColor: 'var(--border)',
            background: 'var(--bg-primary)',
          }}
          value={step.agent_id || ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdate(step.id, { agent_id: e.target.value || null })}
        >
          <option value="">No agent</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.avatar} {a.name}
            </option>
          ))}
        </select>

        {/* Description */}
        <textarea
          className="w-full text-[11px] px-1.5 py-0.5 rounded border bg-transparent resize-none"
          style={{
            color: 'var(--text-secondary)',
            borderColor: 'var(--border)',
            background: 'var(--bg-primary)',
            height: '40px',
          }}
          placeholder="Description..."
          value={step.description || ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdate(step.id, { description: e.target.value })}
        />
      </div>

      {/* Bottom connector (output) — drag from here to create a connection */}
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-full border-2 cursor-crosshair hover:scale-125 transition-transform"
        style={{
          bottom: -CONNECTOR_RADIUS,
          width: CONNECTOR_RADIUS * 2,
          height: CONNECTOR_RADIUS * 2,
          background: 'var(--accent)',
          borderColor: 'var(--bg-elevated)',
          zIndex: 20,
        }}
        title="Drag to connect"
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onConnectStart(step.id);
        }}
      />

      {/* Top connector (input) — drop here to complete a connection */}
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-full border-2 cursor-crosshair hover:scale-125 transition-transform"
        style={{
          top: -CONNECTOR_RADIUS,
          width: CONNECTOR_RADIUS * 2,
          height: CONNECTOR_RADIUS * 2,
          background: 'var(--bg-elevated)',
          borderColor: 'var(--accent)',
          zIndex: 20,
        }}
        title="Drop connection here"
        onMouseUp={(e) => {
          e.stopPropagation();
          onConnectEnd(step.id);
        }}
      />
    </div>
  );
}

// ─── Pipeline List Sidebar ───
function PipelineList({ pipelines, selectedId, onSelect, onCreate, onDelete, onRename }) {
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  return (
    <div
      className="w-[220px] shrink-0 border-r flex flex-col"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', zIndex: 10 }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Pipelines</span>
        <button
          onClick={onCreate}
          className="p-1 rounded hover:bg-white/10"
          style={{ color: 'var(--accent)' }}
          title="New pipeline"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {pipelines.length === 0 && (
          <div className="px-3 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
            No pipelines yet.
            <br />
            Click + to create one.
          </div>
        )}
        {pipelines.map((p) => {
          const stepCount = (p.steps || []).length;
          const isRenaming = renamingId === p.id;
          return (
            <div
              key={p.id}
              className="group flex items-center gap-2 px-3 py-2 mx-1 rounded-md cursor-pointer text-sm transition-colors"
              style={{
                background: selectedId === p.id ? 'var(--accent-light)' : 'transparent',
                color: selectedId === p.id ? 'var(--accent)' : 'var(--text-secondary)',
              }}
              onClick={() => { if (!isRenaming) onSelect(p.id); }}
            >
              <GitBranch size={14} className="shrink-0" />
              {isRenaming ? (
                <input
                  className="flex-1 text-sm bg-transparent outline-none border-b"
                  style={{ borderColor: 'var(--accent)', color: 'var(--text-primary)' }}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => { if (renameValue.trim()) onRename(p.id, renameValue.trim()); setRenamingId(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { if (renameValue.trim()) onRename(p.id, renameValue.trim()); setRenamingId(null); }
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="flex-1 truncate">{p.name}</span>
              )}
              <span className="text-[10px] opacity-60 shrink-0">{stepCount}s</span>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                <button
                  className="p-0.5 rounded hover:opacity-80"
                  style={{ color: 'var(--text-tertiary)' }}
                  onClick={(e) => { e.stopPropagation(); setRenamingId(p.id); setRenameValue(p.name); }}
                  title="Rename"
                >
                  <Edit2 size={11} />
                </button>
                <button
                  className="p-0.5 rounded hover:opacity-80"
                  style={{ color: 'var(--danger, #fa5252)' }}
                  onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
                  title="Delete"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ───
export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState([]);
  const [agents, setAgents] = useState([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState(null);
  const [pipelineName, setPipelineName] = useState('');
  const [steps, setSteps] = useState([]);
  const [selectedStepId, setSelectedStepId] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [loading, setLoading] = useState(true);

  // Drag state
  const [draggingStep, setDraggingStep] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Connection drag state
  const [draggingConnection, setDraggingConnection] = useState(null);
  const [mousePos, setMousePos] = useState(null);

  // Canvas ref for offset calculations
  const canvasRef = useRef(null);
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });

  // Load pipelines and agents
  useEffect(() => {
    Promise.all([api.getPipelines(), api.getAgents()])
      .then(([pips, ags]) => {
        setPipelines(pips);
        setAgents(ags);
        if (pips.length > 0) {
          selectPipeline(pips[0]);
        }
      })
      .catch(() => toast.error('Failed to load pipelines'))
      .finally(() => setLoading(false));
  }, []);

  // Update canvas offset when ref changes
  useEffect(() => {
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      setCanvasOffset({ x: rect.left, y: rect.top });
    }
  });

  function selectPipeline(pipeline) {
    setSelectedPipelineId(pipeline.id);
    setPipelineName(pipeline.name);
    setSteps(pipeline.steps || []);
    setSelectedStepId(null);
    setIsDirty(false);
  }

  // ─── Pipeline CRUD ───
  async function handleCreate() {
    try {
      const pipeline = await api.createPipeline({ name: 'New Pipeline', steps: [] });
      setPipelines((prev) => [pipeline, ...prev]);
      selectPipeline(pipeline);
      toast.success('Pipeline created');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleSave() {
    if (!selectedPipelineId) return;
    try {
      const updated = await api.updatePipeline(selectedPipelineId, { name: pipelineName, steps });
      setPipelines((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setIsDirty(false);
      toast.success('Pipeline saved');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this pipeline?')) return;
    try {
      await api.deletePipeline(id);
      setPipelines((prev) => prev.filter((p) => p.id !== id));
      if (selectedPipelineId === id) {
        setSelectedPipelineId(null);
        setPipelineName('');
        setSteps([]);
      }
      toast.success('Pipeline deleted');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleRun() {
    if (!selectedPipelineId) return;
    if (isDirty) {
      toast.error('Save the pipeline before running');
      return;
    }
    try {
      const result = await api.runPipeline(selectedPipelineId);
      toast.success(`Pipeline started: ${result.tasks.length} tasks created`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  // ─── Step Management ───
  function addStep() {
    // Place new steps in a staggered grid position
    const count = steps.length;
    const col = count % 3;
    const row = Math.floor(count / 3);
    const x = snapToGrid(60 + col * (NODE_W + 60));
    const y = snapToGrid(40 + row * (NODE_H + 80));

    const newStep = {
      id: generateId(),
      title: `Step ${count + 1}`,
      agent_id: null,
      description: '',
      x,
      y,
      next: [],
    };
    setSteps((prev) => [...prev, newStep]);
    setSelectedStepId(newStep.id);
    setIsDirty(true);
  }

  function updateStep(id, changes) {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...changes } : s))
    );
    setIsDirty(true);
  }

  function deleteStep(id) {
    setSteps((prev) => {
      // Remove step and remove all references to it in next arrays
      return prev
        .filter((s) => s.id !== id)
        .map((s) => ({
          ...s,
          next: (s.next || []).filter((nid) => nid !== id),
        }));
    });
    if (selectedStepId === id) setSelectedStepId(null);
    setIsDirty(true);
  }

  // ─── Connection Handling ───
  function handleConnectStart(stepId) {
    setDraggingConnection(stepId);
  }

  function handleConnectEnd(targetId) {
    if (!draggingConnection || draggingConnection === targetId) {
      setDraggingConnection(null);
      return;
    }

    // Check for duplicate
    const source = steps.find((s) => s.id === draggingConnection);
    if (source && !(source.next || []).includes(targetId)) {
      // Check for direct reverse connection (prevent trivial cycles)
      const target = steps.find((s) => s.id === targetId);
      if (target && (target.next || []).includes(draggingConnection)) {
        toast.error('Cannot create a direct circular connection');
        setDraggingConnection(null);
        return;
      }
      updateStep(draggingConnection, {
        next: [...(source.next || []), targetId],
      });
    }
    setDraggingConnection(null);
  }

  // ─── Node Dragging ───
  function handleDragStart(stepId, e) {
    const step = steps.find((s) => s.id === stepId);
    if (!step || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setDraggingStep(stepId);
    setDragOffset({
      x: e.clientX - rect.left - step.x,
      y: e.clientY - rect.top - step.y,
    });
    setSelectedStepId(stepId);
  }

  const handleMouseMove = useCallback(
    (e) => {
      setMousePos({ x: e.clientX, y: e.clientY });

      if (draggingStep && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const x = snapToGrid(Math.max(0, e.clientX - rect.left - dragOffset.x));
        const y = snapToGrid(Math.max(0, e.clientY - rect.top - dragOffset.y));
        setSteps((prev) =>
          prev.map((s) => (s.id === draggingStep ? { ...s, x, y } : s))
        );
        setIsDirty(true);
      }
    },
    [draggingStep, dragOffset]
  );

  const handleMouseUp = useCallback(() => {
    if (draggingStep) {
      setDraggingStep(null);
    }
    if (draggingConnection) {
      // Dropped in empty space - cancel
      setDraggingConnection(null);
    }
  }, [draggingStep, draggingConnection]);

  // Remove a specific connection
  function removeConnection(sourceId, targetId) {
    updateStep(sourceId, {
      next: (steps.find((s) => s.id === sourceId)?.next || []).filter((nid) => nid !== targetId),
    });
  }

  // Compute canvas size dynamically
  const canvasSize = useMemo(() => {
    let maxX = 800;
    let maxY = 600;
    for (const s of steps) {
      maxX = Math.max(maxX, s.x + NODE_W + 100);
      maxY = Math.max(maxY, s.y + NODE_H + 100);
    }
    return { width: maxX, height: maxY };
  }, [steps]);

  if (loading) {
    return (
      <div className="flex h-screen" style={{ background: 'var(--bg-primary)' }}>
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full" style={{ borderColor: 'var(--accent)' }} />
        </div>
        <BottomBar />
      </div>
    );
  }

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top toolbar */}
        <header
          className="flex items-center gap-3 px-4 h-14 border-b shrink-0"
          style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
        >
          <GitBranch size={20} style={{ color: 'var(--accent)' }} />
          <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Pipeline Builder
          </h1>

          {selectedPipelineId && (
            <>
              <div className="mx-2 w-px h-6" style={{ background: 'var(--border)' }} />
              <input
                className="text-sm font-medium bg-transparent outline-none border-b border-transparent focus:border-current px-1"
                style={{ color: 'var(--text-primary)', minWidth: '120px' }}
                value={pipelineName}
                onChange={(e) => {
                  setPipelineName(e.target.value);
                  setIsDirty(true);
                }}
                placeholder="Pipeline name..."
              />
              {isDirty && (
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--warning)', color: '#000' }}>
                  unsaved
                </span>
              )}

              <div className="flex-1" />

              <button
                onClick={addStep}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors hover:opacity-80"
                style={{
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                  background: 'var(--bg-elevated)',
                }}
              >
                <Plus size={14} />
                Add Step
              </button>

              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-80"
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                }}
              >
                <Save size={14} />
                Save
              </button>

              <button
                onClick={handleRun}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-80"
                style={{
                  background: 'var(--success, #40c057)',
                  color: '#fff',
                }}
              >
                <Play size={14} />
                Run Pipeline
              </button>
            </>
          )}
        </header>

        <div className="flex flex-1 min-h-0">
          {/* Pipeline list panel */}
          <PipelineList
            pipelines={pipelines}
            selectedId={selectedPipelineId}
            onSelect={(id) => {
              const pipeline = pipelines.find((p) => p.id === id);
              if (pipeline) selectPipeline(pipeline);
            }}
            onCreate={handleCreate}
            onDelete={handleDelete}
            onRename={async (id, newName) => {
              try {
                const pipeline = pipelines.find((p) => p.id === id);
                if (!pipeline) return;
                await api.updatePipeline(id, { ...pipeline, name: newName, steps: pipeline.steps || [] });
                setPipelines((prev) => prev.map((p) => p.id === id ? { ...p, name: newName } : p));
                if (selectedPipelineId === id) setPipelineName(newName);
                toast.success('Pipeline renamed');
              } catch (err) { toast.error(err.message); }
            }}
          />

          {/* Canvas area */}
          <div className="flex-1 flex flex-col min-w-0">
            {!selectedPipelineId ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ color: 'var(--text-tertiary)' }}>
                <GitBranch size={48} />
                <p className="text-sm">Select or create a pipeline to get started</p>
                <button
                  onClick={handleCreate}
                  className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  <Plus size={16} />
                  New Pipeline
                </button>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Canvas */}
                <div
                  ref={canvasRef}
                  className="flex-1 overflow-auto relative"
                  style={{
                    background: 'var(--bg-primary)',
                    backgroundImage:
                      'radial-gradient(circle, var(--border) 1px, transparent 1px)',
                    backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
                    cursor: draggingConnection ? 'crosshair' : draggingStep ? 'grabbing' : 'default',
                  }}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onClick={() => {
                    setSelectedStepId(null);
                  }}
                >
                  <div
                    className="relative"
                    style={{
                      minWidth: canvasSize.width,
                      minHeight: canvasSize.height,
                    }}
                  >
                    <ConnectionLines
                      steps={steps}
                      draggingConnection={draggingConnection}
                      mousePos={mousePos}
                      canvasOffset={canvasOffset}
                    />

                    {steps.map((step) => (
                      <StepNode
                        key={step.id}
                        step={step}
                        agents={agents}
                        selected={selectedStepId === step.id}
                        onSelect={setSelectedStepId}
                        onUpdate={updateStep}
                        onDelete={deleteStep}
                        onConnectStart={handleConnectStart}
                        onConnectEnd={handleConnectEnd}
                        onDragStart={handleDragStart}
                      />
                    ))}

                    {steps.length === 0 && (
                      <div
                        className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        <AlertCircle size={32} />
                        <p className="text-sm">This pipeline has no steps yet.</p>
                        <button
                          onClick={addStep}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium"
                          style={{ background: 'var(--accent)', color: '#fff' }}
                        >
                          <Plus size={14} />
                          Add First Step
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Connections detail panel */}
                {selectedStepId && (
                  <div
                    className="shrink-0 border-t px-4 py-2 flex items-center gap-4 text-xs"
                    style={{
                      background: 'var(--bg-secondary)',
                      borderColor: 'var(--border)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {steps.find((s) => s.id === selectedStepId)?.title || 'Step'}
                    </span>
                    <ArrowRight size={12} />
                    <span>Connections:</span>
                    {(() => {
                      const step = steps.find((s) => s.id === selectedStepId);
                      const nextSteps = (step?.next || []).map((nid) => steps.find((s) => s.id === nid)).filter(Boolean);
                      if (nextSteps.length === 0) return <span className="italic opacity-60">none</span>;
                      return nextSteps.map((ns) => (
                        <span
                          key={ns.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                          style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}
                        >
                          {ns.title}
                          <button
                            className="hover:text-red-500"
                            onClick={() => removeConnection(selectedStepId, ns.id)}
                            title="Remove connection"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ));
                    })()}
                    <span className="ml-2 opacity-50">
                      Drag from bottom connector to another step's top connector to add connections.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <BottomBar />
      </div>
    </div>
  );
}
