import { describe, expect, it } from 'vitest'

import { EXERCISE_TYPES, type ExerciseType } from '../../src/domain/exercise-type'
import {
  planTypeSwitch,
  type TypeSwitchPlan,
  type TypeSwitchScope,
} from '../../src/domain/exercise-type-switch'

const SCOPES: TypeSwitchScope[] = ['workout', 'workout-and-registry']

function plan(
  loggedType: ExerciseType,
  target: ExerciseType,
  scope: TypeSwitchScope,
  registryType: ExerciseType | null = null,
): TypeSwitchPlan {
  return planTypeSwitch({ loggedType, target, registryType, scope })
}

const NOTHING = {
  changesKind: false,
  dropsPlan: false,
  recordsType: false,
  seedsLadder: false,
  opensPlanForm: false,
  offersRelabel: false,
}

describe('planTypeSwitch', () => {
  describe('on a card that already shows the target', () => {
    for (const type of EXERCISE_TYPES) {
      for (const scope of SCOPES) {
        it(`does nothing for ${type} in ${scope} scope`, () => {
          expect(plan(type, type, scope, null)).toMatchObject(NOTHING)
        })
      }
    }
  })

  describe('from the card menu', () => {
    it('switches strength to duration by changing the kind and nothing else', () => {
      expect(plan('strength', 'duration', 'workout')).toEqual({
        ...NOTHING,
        target: 'duration',
        announcedAs: 'duration',
        changesKind: true,
      })
    })

    it('switches strength to interval by changing the kind and opening the plan form', () => {
      expect(plan('strength', 'interval', 'workout')).toEqual({
        ...NOTHING,
        target: 'interval',
        announcedAs: 'interval',
        changesKind: true,
        opensPlanForm: true,
      })
    })

    it('switches duration to interval in place and opens the plan form', () => {
      expect(plan('duration', 'interval', 'workout')).toEqual({
        ...NOTHING,
        target: 'interval',
        announcedAs: 'interval',
        opensPlanForm: true,
      })
    })

    it('switches interval to duration in place by dropping the plan', () => {
      expect(plan('interval', 'duration', 'workout')).toEqual({
        ...NOTHING,
        target: 'duration',
        announcedAs: 'duration',
        dropsPlan: true,
      })
    })

    it('drops the plan when an interval card changes kind', () => {
      for (const target of ['strength', 'bodyweight'] as const) {
        expect(plan('interval', target, 'workout')).toMatchObject({
          changesKind: true,
          dropsPlan: true,
        })
      }
    })

    it('leaves the plan alone on a card that has none', () => {
      for (const loggedType of ['strength', 'duration', 'bodyweight'] as const) {
        for (const target of EXERCISE_TYPES) {
          expect(plan(loggedType, target, 'workout').dropsPlan).toBe(false)
        }
      }
    })

    it('switches to bodyweight with the relabel offer but no ladder for this workout only', () => {
      for (const loggedType of ['strength', 'duration', 'interval'] as const) {
        expect(plan(loggedType, 'bodyweight', 'workout')).toMatchObject({
          changesKind: true,
          seedsLadder: false,
          offersRelabel: true,
          recordsType: false,
        })
      }
    })

    it('seeds the ladder and records the type when the registry is updated too', () => {
      for (const loggedType of ['strength', 'duration', 'interval'] as const) {
        expect(plan(loggedType, 'bodyweight', 'workout-and-registry', loggedType)).toMatchObject({
          changesKind: true,
          seedsLadder: true,
          offersRelabel: true,
          recordsType: true,
        })
      }
    })

    it('seeds no ladder for this workout only even when the registry already records bodyweight', () => {
      expect(plan('strength', 'bodyweight', 'workout', 'bodyweight')).toMatchObject({
        seedsLadder: false,
        offersRelabel: true,
      })
    })

    it('records the type only for the registry scope', () => {
      for (const loggedType of EXERCISE_TYPES) {
        for (const target of EXERCISE_TYPES) {
          if (loggedType === target) {
            continue
          }
          expect(plan(loggedType, target, 'workout', null).recordsType).toBe(false)
          expect(plan(loggedType, target, 'workout-and-registry', null).recordsType).toBe(true)
        }
      }
    })

    it('skips recording a type the registry already has', () => {
      expect(plan('duration', 'interval', 'workout-and-registry', 'interval').recordsType).toBe(
        false,
      )
    })

    it('offers the relabel only on a switch to bodyweight', () => {
      for (const loggedType of EXERCISE_TYPES) {
        for (const target of ['strength', 'duration', 'interval'] as const) {
          expect(plan(loggedType, target, 'workout-and-registry').offersRelabel).toBe(false)
        }
      }
    })

    it('announces the target type, which is what the card is switched to', () => {
      for (const target of EXERCISE_TYPES) {
        expect(
          plan(target === 'strength' ? 'bodyweight' : 'strength', target, 'workout'),
        ).toMatchObject({ target, announcedAs: target })
      }
    })
  })
})
