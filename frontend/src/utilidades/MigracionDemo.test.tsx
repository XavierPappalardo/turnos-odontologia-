import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'

describe('MigracionDemo UI', () => {
  it('Dado la app Cuando se abre admin migración Entonces muestra controles básicos', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /turnos-odontologia/i })).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: /admin migración\/demo/i })
    fireEvent.click(btn)
    expect(screen.getByRole('heading', { name: /demo y migración/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cargar demo ficticia/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /preview/i })).toBeInTheDocument()
  })
})
