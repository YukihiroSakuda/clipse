import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import Editor from './routes/Editor'
import Gallery from './routes/Gallery'
import Overlay from './routes/Overlay'
import Recorder from './routes/Recorder'
import ScrollProgress from './routes/ScrollProgress'
import Settings from './routes/Settings'

const label = getCurrentWebviewWindow().label

export default function App() {
  if (label.startsWith('overlay')) return <Overlay />
  if (label === 'editor') return <Editor />
  if (label === 'settings') return <Settings />
  if (label === 'recorder') return <Recorder />
  if (label === 'scroll-progress') return <ScrollProgress />
  return <Gallery />
}
