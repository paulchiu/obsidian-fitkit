Fitness tracking dashboard with workout history and progress metrics.
## Exercises

```dataview
LIST
FROM "Area/Fitness/Exercises"
SORT file.name ASC
```

## Recent Workouts

```dataview
TABLE date, name AS Workout
FROM "Area/Fitness/Workouts"
WHERE type = "workout"
SORT date DESC
LIMIT 10
```

## Squat

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.weight) + "kg"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Squat") AND L.set
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Squat") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
```

## Deadlift

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.weight) + "kg"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Deadlift") AND L.set
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Deadlift") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
```

## Machine Row

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.weight) + "kg"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Machine Row") AND L.set
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Machine Row") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
```

## Calf Raise

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.weight) + "kg"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Calf Raise") AND L.set
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Calf Raise") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
```

## Dumbbell Shoulder Press

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.weight) + "kg"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Dumbbell Shoulder Press") AND L.set
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Dumbbell Shoulder Press") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
```

## Machine Shoulder Press

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.weight) + "kg"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Machine Shoulder Press") AND L.set
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Machine Shoulder Press") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
```

## Middle Split

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.duration) + "s"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Middle Split") AND L.duration
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.duration AS "Duration (s)"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Middle Split") AND L.duration
SORT file.name DESC
LIMIT 10
```

## Front Split Left

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.duration) + "s"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Front Split Left") AND L.duration
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.duration AS "Duration (s)"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Front Split Left") AND L.duration
SORT file.name DESC
LIMIT 10
```

## Front Split Right

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.duration) + "s"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Front Split Right") AND L.duration
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.duration AS "Duration (s)"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Front Split Right") AND L.duration
SORT file.name DESC
LIMIT 10
```

## Barbell Shoulder Press

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.weight) + "kg"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Barbell Shoulder Press") AND L.set
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Barbell Shoulder Press") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
```

## Machine Shoulder Fly

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.weight) + "kg"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Machine Shoulder Fly") AND L.set
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Machine Shoulder Fly") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
```

## Barbell Row

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.weight) + "kg"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Barbell Row") AND L.set
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Barbell Row") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
```

## Cable Skull Crushers

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.weight) + "kg"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Cable Skull Crushers") AND L.set
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Cable Skull Crushers") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
```

## Machine Abs

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.weight) + "kg"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Machine Abs") AND L.set
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Machine Abs") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
```

## Machine Pushdown

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.weight) + "kg"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Machine Pushdown") AND L.set
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Machine Pushdown") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
```

## Kneeling Quad Stretch Left

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.duration) + "s"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Kneeling Quad Stretch Left") AND L.duration
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.duration AS "Duration (s)"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Kneeling Quad Stretch Left") AND L.duration
SORT file.name DESC
LIMIT 10
```

## Kneeling Quad Stretch Right

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.duration) + "s"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Kneeling Quad Stretch Right") AND L.duration
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.duration AS "Duration (s)"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Kneeling Quad Stretch Right") AND L.duration
SORT file.name DESC
LIMIT 10
```

## Front Split

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.duration) + "s"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Front Split") AND L.duration
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.duration AS "Duration (s)"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Front Split") AND L.duration
SORT file.name DESC
LIMIT 10
```

## Kneeling Quad Stretch

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.duration) + "s"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Kneeling Quad Stretch") AND L.duration
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.duration AS "Duration (s)"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Kneeling Quad Stretch") AND L.duration
SORT file.name DESC
LIMIT 10
```

## Bar Skull Crushers

```dataview
LIST WITHOUT ID "**PB:** " + max(rows.L.weight) + "kg"
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Bar Skull Crushers") AND L.set
GROUP BY true
```

```dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Bar Skull Crushers") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
```
