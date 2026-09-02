import { redirect } from 'next/navigation'

// La radice non ha contenuto proprio: il pannello vive sotto /dashboard, e
// chi non ha sessione viene rimandato al login dal middleware.
export default function HomePage() {
  redirect('/dashboard')
}
