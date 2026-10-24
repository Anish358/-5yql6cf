import { useEffect, useState } from 'react'

type State<T> = { data: T | null; error: string | null; loading: boolean }

/** Runs `fn` whenever `key` changes; ignores responses from superseded requests. */
export function useAsync<T>(fn: () => Promise<T>, key: string): State<T> {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true })

  useEffect(() => {
    let active = true
    setState((s) => ({ ...s, loading: true, error: null }))
    fn()
      .then((data) => active && setState({ data, error: null, loading: false }))
      .catch((e: Error) => active && setState({ data: null, error: e.message, loading: false }))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}
