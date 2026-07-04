import React from 'react'
import ReactDOM from 'react-dom/client'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import App from './App'
import './styles/globals.css'

// globals.css sets body { background: #0F1117 }. Override it before React renders
// so transparent windows (overlay, scroll-progress) never flash black.
const label = getCurrentWebviewWindow().label
if (label.startsWith('overlay') || label === 'scroll-progress') {
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
