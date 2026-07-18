CREATE TABLE IF NOT EXISTS public.user_ui_preferences (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preference_key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, preference_key)
);

ALTER TABLE public.user_ui_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences"
  ON public.user_ui_preferences
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own preferences"
  ON public.user_ui_preferences
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own preferences"
  ON public.user_ui_preferences
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own preferences"
  ON public.user_ui_preferences
  FOR DELETE
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.update_user_ui_preference_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER set_user_ui_preferences_updated_at
  BEFORE UPDATE ON public.user_ui_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_ui_preference_updated_at();
