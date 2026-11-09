import { useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { PortalPaciente } from './portal/PortalPaciente'
import { MigracionDemo } from './utilidades/MigracionDemo'

function App() {
  const [mostrarAdmin, setMostrarAdmin] = useState(false)
  return (
    <main>
      <AppHeader />
      <div style={{ padding: '8px 12px' }}>
        <button type="button" onClick={() => setMostrarAdmin((v) => !v)}>
          {mostrarAdmin ? 'Ocultar admin migración' : 'Admin migración/demo'}
        </button>
      </div>
      {mostrarAdmin && <MigracionDemo />}
      <PortalPaciente />
    </main>
  )
}

export default App

