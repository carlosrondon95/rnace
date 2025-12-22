-- 1. Buscar la función exacta que contiene el texto problemático
-- Esto nos dirá el nombre de la función que tenemos que editar.
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_definition ILIKE '%recuperación%' 
AND routine_type = 'FUNCTION' 
AND specific_schema = 'public';

-- 2. Si la anterior no da resultados, buscar lógica relacionada con festivos
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_definition ILIKE '%festivo%' 
AND routine_type = 'FUNCTION' 
AND specific_schema = 'public';

-- 3. Ver si hay triggers en la tabla de festivos
SELECT trigger_name, action_statement 
FROM information_schema.triggers
WHERE event_object_table = 'festivos';
