export type Replace<OriginlType, ReplaceTypes> = Omit<
  OriginlType,
  keyof ReplaceTypes
> &
  ReplaceTypes;
