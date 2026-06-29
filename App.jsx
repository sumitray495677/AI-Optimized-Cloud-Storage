import Login from "./Login";

import React, { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import FileList from './components/FileList'
import UploadManager from './components/UploadManager'
import FolderList from './components/FolderList'
import { listFiles, deleteFile } from './api/filesApi'

export default function App() {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useQuery(['files'], listFiles)
  const files = Array.isArray(data) ? data : (data?.value ?? [])
  const [selectedFolder, setSelectedFolder] = useState(null)
  const [q, setQ] = useState('')

  function handleUploaded(meta) {
    qc.invalidateQueries(['files'])
  }

  async function handleDelete(id) {
    if (!id) return
    if (!confirm('Delete this file?')) return
    try {
      qc.setQueryData(['files'], (old = []) => old.filter((f) => f.id !== id))
      await deleteFile(id)
      qc.invalidateQueries(['files'])
    } catch (err) {
      qc.invalidateQueries(['files'])
      alert('Delete failed — check console')
      console.error('deleteFile error', err)
    }
  }

  // filtering: folder + free-text search across name, tags, summary, ocr_text
  const filteredFiles = (Array.isArray(files) ? files : [])
    .filter(f => {
      // folder filter
      if (selectedFolder) {
        try {
          const tag = Array.isArray(f.ai_tags) && f.ai_tags.length ? String(f.ai_tags[0]).replace(/^#/, '') :
                      (typeof f.ai_tags === 'string' && f.ai_tags.trim() ? (f.ai_tags.startsWith('[') ? JSON.parse(f.ai_tags)[0] : f.ai_tags) : '')
          if (String(tag).replace(/^#/, '') !== selectedFolder) return false
        } catch { return false }
      }
      // search filter
      if (q && q.trim()) {
        const qq = q.trim().toLowerCase()
        const hay = [
          f.filename || '',
          (Array.isArray(f.ai_tags) ? f.ai_tags.join(' ') : String(f.ai_tags || '')),
          f.ai_summary || '',
          f.ocr_text || ''
        ].join(' ').toLowerCase()
        return hay.includes(qq)
      }
      return true
    })

    const [auth, setAuth] = useState(false);
    useEffect(() => { localStorage.removeItem('auth'); }, []);


    if (!auth) {
      return <Login onLogin={() => setAuth(true)} />;
    }


  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="md:col-span-1">
          <div className="card">
            <div className="app-header">
              <div>
                <div className="app-title">My Cloud</div>
                <div className="muted small">Smart file manager</div>
              </div>
            </div>

            <FolderList
              files={files}
              selected={selectedFolder}
              onSelect={(name) => setSelectedFolder((prev) => (prev === name ? null : name))}
            />

            <div className="mt-4 bg-white rounded-lg shadow p-4 text-xs text-gray-600">
              <div><strong>Tip:</strong> Click a folder to filter the list. Click again to clear.</div>
            </div>
          </div>
        </div>

        <div className="md:col-span-2">
          <div className="card mb-4">
            <div style={{ display:'flex', gap:12, alignItems:'center' }}>
              <div className="search-box" style={{ flex:1 }}>
                <input
                  placeholder="Search filename, tags, summary, or file text..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <button
                className="btn-small"
                style={{ background: 'linear-gradient(90deg,var(--accent),var(--accent-600))', color:'#fff', border:0, borderRadius:8, padding:'8px 12px' }}
                onClick={() => { /* reserved for advanced search */ }}
              >
                Search
              </button>
            </div>
            <div className="muted small mt-3">Results: {filteredFiles.length}</div>
          </div>

          {isLoading ? (
            <div className="card">Loading files…</div>
          ) : (
            <FileList files={filteredFiles} onDelete={handleDelete} />
          )}
        </div>

        <div>
          <div className="card mb-4">
            <UploadManager onUploaded={handleUploaded} />
          </div>

          <div className="card">
            <h4 className="text-sm font-semibold mb-2">Quick tips</h4>
            <ul className="text-xs text-gray-600 mt-2 space-y-1">
              <li>• Drag & drop or click to add files.</li>
              <li>• Files are auto-sorted into folders by AI tag.</li>
              <li>• Use the folder pane to filter files quickly.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
