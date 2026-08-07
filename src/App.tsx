import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import About from './routes/About'
import Editor from './routes/Editor'
import FixedCapture from './routes/FixedCapture'
import Gallery from './routes/Gallery'
import Overlay from './routes/Overlay'
import Pin from './routes/Pin'
import QuickMenu from './routes/QuickMenu'
import Recorder from './routes/Recorder'
import ScrollProgress from './routes/ScrollProgress'
import Settings from './routes/Settings'
import Toast from './routes/Toast'

const label = getCurrentWebviewWindow().label

export default function App() {
  if (label.startsWith('overlay')) return <Overlay />
  // `editor-{n}` — several editors can be open at once (see window::open_editor).
  if (label.startsWith('editor')) return <Editor />
  if (label === 'settings') return <Settings />
  if (label === 'about') return <About />
  if (label === 'recorder') return <Recorder />
  if (label === 'fixed-capture') return <FixedCapture />
  if (label.startsWith('pin-')) return <Pin />
  if (label === 'scroll-progress') return <ScrollProgress />
  if (label === 'toast') return <Toast />
  if (label === 'quickmenu') return <QuickMenu />
  return <Gallery />
}
