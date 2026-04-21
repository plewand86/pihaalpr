import { HashRouter as BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import { Car, LayoutDashboard, ListChecks, Settings as SettingsIcon, Video } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import Cameras from './pages/Cameras'
import Whitelist from './pages/Whitelist'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
    isActive ? 'bg-slate-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'
  }`

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex flex-col min-h-screen">
        <header className="bg-panel border-b border-white/10 px-6 py-3 flex items-center gap-4 shadow">
          <Car className="text-gray-300" size={24} />
          <span className="font-bold text-lg text-gray-200 tracking-wide">PiHA LPR</span>
          <nav className="flex gap-1 ml-6">
            <NavLink to="/" end className={navClass}>
              <LayoutDashboard size={15} /> Dashboard
            </NavLink>
            <NavLink to="/cameras" className={navClass}>
              <Video size={15} /> Kamery
            </NavLink>
            <NavLink to="/whitelist" className={navClass}>
              <ListChecks size={15} /> Biała lista
            </NavLink>
            <NavLink to="/settings" className={navClass}>
              <SettingsIcon size={15} /> Konfiguracja
            </NavLink>
          </nav>
        </header>

        <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/cameras" element={<Cameras />} />
            <Route path="/whitelist" element={<Whitelist />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
