use parking_lot::RwLock;
use std::collections::VecDeque;

pub struct ReadyQueue {
    queue: RwLock<VecDeque<String>>,
}

impl ReadyQueue {
    pub fn new() -> Self {
        Self {
            queue: RwLock::new(VecDeque::new()),
        }
    }

    pub fn enqueue(&self, node_id: String) {
        self.queue.write().push_back(node_id);
    }

    pub fn dequeue(&self) -> Option<String> {
        self.queue.write().pop_front()
    }
}
