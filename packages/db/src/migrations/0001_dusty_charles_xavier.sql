-- First, rename duplicate names to make them unique before adding the constraint
WITH ranked AS (
  SELECT id, name, jelly_team_id,
    ROW_NUMBER() OVER (PARTITION BY name, jelly_team_id ORDER BY id) AS rn
  FROM "api_key"
)
UPDATE "api_key" SET name = name || ' (' || id || ')'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

ALTER TABLE "api_key" ADD CONSTRAINT "api_key_name_jelly_team_id_unique" UNIQUE("name","jelly_team_id");
