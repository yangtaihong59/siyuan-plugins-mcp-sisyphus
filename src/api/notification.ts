import type { SiYuanClient } from './client';
import type {
    IReqPushMsg,
    IReqPushErrMsg,
    IResPushMsg,
} from '../types/api';

/**
 * Push a notification message
 */
export async function pushMsg(
    client: SiYuanClient,
    msg: string,
    timeout?: number
): Promise<IResPushMsg> {
    const request: IReqPushMsg = {
        msg,
        timeout,
    };
    return client.requestWrite<IResPushMsg>('/api/notification/pushMsg', request);
}

/**
 * Push an error notification message
 */
export async function pushErrMsg(
    client: SiYuanClient,
    msg: string,
    timeout?: number
): Promise<IResPushMsg> {
    const request: IReqPushErrMsg = {
        msg,
        timeout,
    };
    return client.requestWrite<IResPushMsg>('/api/notification/pushErrMsg', request);
}
