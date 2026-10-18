import { kindOfType, type ExerciseType } from './exercise-type'

/**
 * Where a card's type switch reaches: this workout only, or this workout plus
 * the registry. A rename onto a name the registry already types is a switch
 * for this workout only.
 */
export type TypeSwitchScope = 'workout' | 'workout-and-registry'

export interface TypeSwitchInput {
  /** What the card shows now, as `loggedTypeOf` reads it. */
  loggedType: ExerciseType
  target: ExerciseType
  registryType: ExerciseType | null
  scope: TypeSwitchScope
}

export interface TypeSwitchPlan {
  target: ExerciseType
  /** The type the cleared-rows notice names. */
  announcedAs: ExerciseType
  /** The stored kind changes, which clears the card's rows and plan. */
  changesKind: boolean
  /** The card's interval plan goes, whether by the kind change or in place. */
  dropsPlan: boolean
  recordsType: boolean
  seedsLadder: boolean
  opensPlanForm: boolean
  offersRelabel: boolean
}

/**
 * Decides the steps of a card type switch. Only a scope that reaches the
 * registry seeds the ladder, since a ladder in a note still typed otherwise is
 * unreadable.
 */
export function planTypeSwitch(input: TypeSwitchInput): TypeSwitchPlan {
  const { loggedType, target, registryType, scope } = input
  const changesKind = kindOfType(loggedType) !== kindOfType(target)
  const toBodyweight = target === 'bodyweight' && changesKind
  const switches = loggedType !== target
  return {
    target,
    announcedAs: target,
    changesKind,
    dropsPlan: loggedType === 'interval' && target !== 'interval',
    recordsType: switches && scope === 'workout-and-registry' && registryType !== target,
    seedsLadder: toBodyweight && scope === 'workout-and-registry',
    opensPlanForm: switches && target === 'interval',
    offersRelabel: toBodyweight,
  }
}
