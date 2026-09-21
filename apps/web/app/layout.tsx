import type { Metadata } from 'next'
// Tipografías servidas por el propio panel (no por Google): en la tienda ya pasó
// que un celular no llegaba a fonts.googleapis.com y todo salía con la fuente de
// respaldo y los iconos como texto. Los iconos (Material Symbols) viven en
// public/fonts/ (ver scripts/bajar-iconos.mjs) y se declaran en globals.css.
import '@fontsource-variable/newsreader'
import '@fontsource-variable/newsreader/wght-italic.css'
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource-variable/inter'
import './globals.css'

export const metadata: Metadata = {
  title: 'La Casita Deli | Admin Terminal',
  description: 'Panel de inventario y ventas para La Casita Deli',
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className="light">
      <head>
        {/* Los iconos se piden desde el arranque: sin esto, el nombre del icono se
            alcanza a ver como texto un instante antes de que llegue la fuente. */}
        <link rel="preload" href="/fonts/material-symbols-subset.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="bg-background text-on-surface antialiased flex min-h-screen">
        {children}
      </body>
    </html>
  )
}
