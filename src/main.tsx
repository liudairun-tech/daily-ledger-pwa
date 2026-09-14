import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

const updateSW = registerSW({
  onNeedRefresh() {
    if (window.confirm('每日账本有新版本，是否立即更新？账本数据不会被清除。')) void updateSW(true)
  }
})

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
