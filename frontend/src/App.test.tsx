import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renderiza el encabezado de la aplicación', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: /turnos-odontologia/i }),
    ).toBeInTheDocument()
  })
})
