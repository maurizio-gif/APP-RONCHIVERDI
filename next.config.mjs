/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Le pagine del pannello leggono dati live da Supabase: niente cache
    // lato client tra una navigazione e l'altra, altrimenti passando da
    // una sezione all'altra si vedono dati vecchi finché non si ricarica.
    staleTimes: {
      dynamic: 0,
    },
  },
}

export default nextConfig
