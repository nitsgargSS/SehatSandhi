/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        teal:  { 50:'#e8f8f3', 100:'#c3edd9', 400:'#35c28a', 500:'#1fba87', 600:'#1BA37A', 700:'#158a63', DEFAULT:'#1BA37A' },
        navy:  { 50:'#eaf0f8', 100:'#c0d3ea', 400:'#3a7bc8', 600:'#1E66B0', 700:'#15487E', 800:'#0d3260', DEFAULT:'#15487E' },
        amber: { 400:'#f9c44a', 500:'#F5A524', DEFAULT:'#F5A524' }
      },
      fontFamily: { poppins: ['Poppins', 'sans-serif'] },
      // Bumps text-xs and text-sm up one step, site-wide, in every
      // file that already uses these classes — no component changes
      // needed. base/lg/xl/etc. are left as Tailwind's defaults,
      // since only xs/sm were flagged as too small to read.
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.25rem' }], // was 12px → now 14px (old 'sm' size)
        sm: ['1rem', { lineHeight: '1.5rem' }],       // was 14px → now 16px (old 'base' size)
      }
    }
  },
  plugins: []
}
