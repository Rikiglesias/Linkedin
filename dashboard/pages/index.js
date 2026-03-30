import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const STATUSES = ['pending', 'in_progress', 'completed'];
const PRIORITY_COLORS = {
  high:   'text-red-400',
  medium: 'text-yellow-400',
  low:    'text-gray-500',
};
const STATUS_LABELS = {
  pending:     '⏳ Pending',
  in_progress: '🔄 In Progress',
  completed:   '✅ Completed',
};

export default function TodoDashboard() {
  const [todos, setTodos]     = useState([]);
  const [newTitle, setNewTitle]     = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newAgent, setNewAgent]     = useState('');
  const [loading, setLoading] = useState(true);

  // Carica todos e sottoscrive Realtime
  useEffect(() => {
    fetchTodos();

    const channel = supabase
      .channel('todos-realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'todos' },
        () => fetchTodos()
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  async function fetchTodos() {
    const { data, error } = await supabase
      .from('todos')
      .select('*')
      .order('updated_at', { ascending: false });

    if (!error) setTodos(data ?? []);
    setLoading(false);
  }

  async function addTodo(e) {
    e.preventDefault();
    if (!newTitle.trim()) return;

    await supabase.from('todos').insert({
      title:          newTitle.trim(),
      status:         'pending',
      priority:       newPriority,
      assigned_agent: newAgent.trim() || null,
    });

    setNewTitle('');
    setNewAgent('');
    setNewPriority('medium');
  }

  async function updateStatus(id, status) {
    await supabase.from('todos').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  }

  async function deleteTodo(id) {
    await supabase.from('todos').delete().eq('id', id);
  }

  const byStatus = (status) => todos.filter(t => t.status === status);

  return (
    <div className="min-h-screen bg-surface p-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white tracking-tight">Todo Dashboard</h1>
        <p className="text-muted text-sm mt-1">Realtime via Supabase Websockets</p>
      </div>

      {/* Add form */}
      <form onSubmit={addTodo} className="bg-panel border border-border rounded-lg p-4 mb-8 flex flex-wrap gap-3">
        <input
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          placeholder="Nuova task..."
          className="flex-1 min-w-48 bg-surface border border-border rounded px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent"
        />
        <select
          value={newPriority}
          onChange={e => setNewPriority(e.target.value)}
          className="bg-surface border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
        >
          <option value="high">🔴 High</option>
          <option value="medium">🟡 Medium</option>
          <option value="low">⚪ Low</option>
        </select>
        <input
          value={newAgent}
          onChange={e => setNewAgent(e.target.value)}
          placeholder="Agente (opzionale)"
          className="w-40 bg-surface border border-border rounded px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="bg-accent hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
        >
          + Aggiungi
        </button>
      </form>

      {/* Columns */}
      {loading ? (
        <p className="text-muted text-center py-12">Caricamento...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {STATUSES.map(status => (
            <div key={status} className="bg-panel border border-border rounded-lg p-4">
              <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">
                {STATUS_LABELS[status]}
                <span className="ml-2 text-xs bg-surface px-1.5 py-0.5 rounded">
                  {byStatus(status).length}
                </span>
              </h2>

              <div className="space-y-2">
                {byStatus(status).map(todo => (
                  <div key={todo.id} className="bg-surface border border-border rounded p-3 group">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm text-white leading-snug">{todo.title}</span>
                      <button
                        onClick={() => deleteTodo(todo.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition-all text-xs"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className={`text-xs ${PRIORITY_COLORS[todo.priority] ?? 'text-muted'}`}>
                        {todo.priority}
                      </span>
                      {todo.assigned_agent && (
                        <span className="text-xs text-muted bg-panel px-1.5 py-0.5 rounded">
                          @{todo.assigned_agent}
                        </span>
                      )}
                    </div>

                    {/* Status buttons */}
                    <div className="flex gap-1 mt-3">
                      {STATUSES.filter(s => s !== status).map(s => (
                        <button
                          key={s}
                          onClick={() => updateStatus(todo.id, s)}
                          className="text-xs text-muted hover:text-accent border border-border hover:border-accent px-2 py-1 rounded transition-colors"
                        >
                          → {s.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {byStatus(status).length === 0 && (
                  <p className="text-muted text-xs text-center py-4">Vuoto</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
