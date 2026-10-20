import {
  Component,
  h,
  type ComponentChildren,
  type ComponentClass,
  type FunctionComponent,
} from 'preact'

/**
 * Wraps `Inner` so it skips a render while `same(old, next)` holds. This is deliberately the only
 * class component: without `preact/compat`, `shouldComponentUpdate` is the one way to skip a render.
 */
export function memo<P>(
  Inner: FunctionComponent<P>,
  same: (a: P, b: P) => boolean,
): ComponentClass<P> {
  class Memo extends Component<P> {
    static displayName = `Memo(${Inner.displayName ?? Inner.name})`
    shouldComponentUpdate(next: P): boolean {
      return !same(this.props, next)
    }
    render(): ComponentChildren {
      return h(Inner, this.props)
    }
  }
  return Memo
}
