import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()]
})

// \narrate{Number of 8-letter strings with i vowels}{| E_i |} = \narrate{Choose i locations for the vowels}{\binom{8}{i}} . \narrate{Choose the vowels}{5^i} . \narrate{Choose the remaining letters}{21^{8-i}}

const tt = {
  latex: "| E_i | = \\binom{8}{i} . 5^i . 21^{8-i}",
  narrations: [
    {
      term: "| E_i |",
      narration: "Number of 8-letter strings with i vowels",
      pos: "1"
    },
    {
      term: "\\binom{8}{i}",
      narration: "Choose i locations for the vowels",
      pos: "1"
    },
    {
      term: "5^i",
      narration: "Choose the vowels",
      pos: "1"
    },
    {
      term: "21^{8-i}",
      narration: "Choose the remaining letters",
      pos: "1"
    }
  ]
}