import { menash, Topology } from 'menashmq';
import sleep from './general';
import { logger } from '../index';
import { MongoWatcher } from './mongoWatcher';
import { sendFailedMsg } from './message';
import { RabbitDataType } from '../paramTypes';

/**
 * Get rabbit health status
 * @returns {boolean} isHealthy - true if healthy
 */
export function getRabbitHealthStatus(): boolean {
  return !menash.isClosed && menash.isReady;
}

export class Rabbit {
  rabbitData: RabbitDataType;

  healthCheckInterval = 30000;

  constructor(rabbitData: RabbitDataType) {
    this.rabbitData = rabbitData;
    if (rabbitData.healthCheckInterval) this.healthCheckInterval = rabbitData.healthCheckInterval;
  }

  /**
   * Init rabbitmq (connection and queues)
   */
  async initRabbit(): Promise<void> {
    await this.initConnection();
    await this.initQueues();
  }

  /**
   * Healthcheck for rabbitMQ connection and reconnecting in case of a failer.
   * @param {MongoWatcher} mongoWatcher - mongoWatcher instance
   */
  async ensureRabbitHealth(mongoWatcher: MongoWatcher): Promise<void> {
    while (true) {
      if (!getRabbitHealthStatus()) {
        // If rabbitMQ unhealthy, close current connection and try reconnect
        await menash.close();
        await this.initRabbit();
        await mongoWatcher.initWatch();
        sendFailedMsg();
      }

      await sleep(this.healthCheckInterval);
    }
  }

  /**
   * Creates rabbitmq connection.
   */
  async initConnection(): Promise<void> {
    // Initialize rabbit connection if the conn isn't ready yet
    logger.log(`connecting to rabbitMQ on URI: ${this.rabbitData.rabbitURI} ...`);

    if (!getRabbitHealthStatus()) {
      await menash.connect(this.rabbitData.rabbitURI, { retries: this.rabbitData.rabbitRetries });
      logger.log(`successful connection to rabbitMQ on URI: ${this.rabbitData.rabbitURI}`);
    } else {
      logger.log(`rabbit ${this.rabbitData.rabbitURI} already connected`);
    }
  }

  /**
   * Init rabbitmq queues and exchanges binding
   */
  async initQueues(): Promise<void> {
    // Create new topology
    const topology: Topology = { queues: [], exchanges: [], bindings: [] };

    const { exchange } = this.rabbitData;
    const { queues } = this.rabbitData;


    if (!(exchange.name in menash.exchanges)) {
      topology.exchanges?.push({ name: exchange.name, type: exchange.type });
    }

    queues.map((queue) => {
      // If queue not exists, create it
      if (!(queue.name in menash.queues)) {
        topology.queues?.push({ name: queue.name, options: { durable: true } });

        topology.bindings?.push({
          source: exchange.name,
          destination: queue.name
        });
      }
    });

    await menash.declareTopology(topology);
  }
}
