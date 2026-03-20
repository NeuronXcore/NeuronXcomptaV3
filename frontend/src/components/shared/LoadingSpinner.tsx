export default function LoadingSpinner({ text = 'Chargement...' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-text-muted">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="mt-4 text-sm">{text}</p>
    </div>
  )
}
