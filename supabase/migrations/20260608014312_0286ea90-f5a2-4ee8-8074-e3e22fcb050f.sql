
CREATE OR REPLACE FUNCTION public.exec_sql(sql text, params jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result jsonb;
  i int;
  n int;
  is_select boolean;
  final_sql text := sql;
  val text;
BEGIN
  n := COALESCE(jsonb_array_length(params), 0);
  -- Replace $N placeholders in reverse order so $10 isn't clobbered by $1
  FOR i IN REVERSE n..1 LOOP
    IF jsonb_typeof(params -> (i - 1)) = 'null' THEN
      val := 'NULL';
    ELSE
      val := quote_nullable(params ->> (i - 1));
    END IF;
    final_sql := regexp_replace(final_sql, '\$' || i || '(?!\d)', val, 'g');
  END LOOP;

  is_select := final_sql ~* '^\s*(select|with)\s' OR final_sql ~* '\sreturning\s';

  IF is_select THEN
    EXECUTE format('SELECT COALESCE(jsonb_agg(t), ''[]''::jsonb) FROM (%s) t', final_sql)
      INTO result;
  ELSE
    EXECUTE final_sql;
    result := '[]'::jsonb;
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.exec_sql(text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_sql(text, jsonb) TO service_role;
