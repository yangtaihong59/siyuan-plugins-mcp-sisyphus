/** Internal symbol cannot be supplied through MCP/CLI JSON. IDs are reserved by the coordinator. */
export const AV_CREATION_CONTEXT = Symbol('avCreationContext');
export type AvCreationStage = 'ids_reserved' | 'av_created' | 'carrier_inserted' | 'verified';
export interface AvCreationProgress {
    avID: string;
    blockID: string;
    parentID: string;
    stage: AvCreationStage;
    currentStep: 'create_av' | 'insert_carrier' | 'verify' | 'complete';
}
export interface AvCreationContext {
    progress: AvCreationProgress;
    checkpoint(stage: AvCreationStage, currentStep: AvCreationProgress['currentStep']): Promise<void>;
}
