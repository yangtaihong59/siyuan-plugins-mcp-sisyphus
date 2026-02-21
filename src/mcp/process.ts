import { ChildProcess, spawn, SpawnOptions } from 'child_process';

export type ProcessStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

type StatusChangeCallback = (status: ProcessStatus) => void;

export class ProcessManager {
  private process: ChildProcess | null = null;
  private status: ProcessStatus = 'stopped';
  private statusChangeCallbacks: StatusChangeCallback[] = [];
  private errorMessage: string = '';

  private setStatus(newStatus: ProcessStatus): void {
    this.status = newStatus;
    this.notifyStatusChange();
  }

  private notifyStatusChange(): void {
    for (const callback of this.statusChangeCallbacks) {
      try {
        callback(this.status);
      } catch {
        // ignore callback error
      }
    }
  }

  async start(command: string[], options?: SpawnOptions): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') {
      throw new Error(`Cannot start process: already ${this.status}`);
    }

    this.setStatus('starting');
    this.errorMessage = '';

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(command[0], command.slice(1), {
          stdio: 'pipe',
          ...options,
        });

        this.process.on('spawn', () => {
          this.setStatus('running');
          resolve();
        });

        this.process.on('error', (error) => {
          this.errorMessage = error.message;
          this.setStatus('error');
          reject(error);
        });

        this.process.on('exit', (code, signal) => {
          if (this.status !== 'stopping') {
            if (code === 0) {
              this.setStatus('stopped');
            } else {
              this.errorMessage = `Process exited with code ${code}, signal ${signal}`;
              this.setStatus('error');
            }
          }
          this.process = null;
        });

        // Do not forward subprocess stdout/stderr to console (no debug output)
        if (this.process.stdout) this.process.stdout.on('data', () => {});
        if (this.process.stderr) this.process.stderr.on('data', () => {});

        setTimeout(() => {
          if (this.status === 'starting') {
            this.setStatus('running');
            resolve();
          }
        }, 5000);

      } catch (error) {
        this.errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.setStatus('error');
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.status === 'stopped' || this.status === 'stopping') {
      return;
    }

    this.setStatus('stopping');

    return new Promise((resolve) => {
      if (!this.process) {
        this.setStatus('stopped');
        resolve();
        return;
      }

      this.process.once('exit', () => {
        this.setStatus('stopped');
        this.process = null;
        resolve();
      });

      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
        this.setStatus('stopped');
        this.process = null;
        resolve();
      }, 5000);

      try {
        this.process.kill('SIGTERM');
      } catch {
        this.process.kill('SIGKILL');
      }
    });
  }

  getStatus(): ProcessStatus {
    return this.status;
  }

  getProcess(): ChildProcess | null {
    return this.process;
  }

  getErrorMessage(): string {
    return this.errorMessage;
  }

  onStatusChange(callback: StatusChangeCallback): void {
    this.statusChangeCallbacks.push(callback);
  }

  offStatusChange(callback: StatusChangeCallback): void {
    const index = this.statusChangeCallbacks.indexOf(callback);
    if (index > -1) {
      this.statusChangeCallbacks.splice(index, 1);
    }
  }

  isRunning(): boolean {
    return this.status === 'running';
  }

  destroy(): void {
    this.statusChangeCallbacks = [];
    if (this.process && !this.process.killed) {
      this.process.kill('SIGKILL');
    }
    this.process = null;
    this.setStatus('stopped');
  }
}
