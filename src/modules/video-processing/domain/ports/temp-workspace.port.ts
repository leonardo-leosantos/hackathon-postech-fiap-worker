export const TEMP_WORKSPACE = Symbol('TEMP_WORKSPACE');

/** Caminhos locais resolvidos para os artefatos temporários de um job. */
export interface JobWorkspace {
  videoPath: string; // e.g. /tmp/videos/{videoId}.mp4
  framesDir: string; // e.g. /tmp/frames/{videoId}/
  zipPath: string; // e.g. /tmp/zips/{videoId}.zip
}

/**
 * Porta de gerenciamento do workspace temporário de um job.
 */
export interface TempWorkspacePort {
  /** Create the temp dirs and return the resolved paths for this job. */
  create(videoId: string): Promise<JobWorkspace>;
  /** Remove ALL temp artifacts for this job. Must never throw (best-effort, log internally). */
  cleanup(workspace: JobWorkspace): Promise<void>;
}
