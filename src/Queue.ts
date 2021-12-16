class Node<T> {
  value: T;
  next?: Node<T>;

  constructor(value: T) {
    this.value = value;
  }
}

export default class Queue<T> {
  root?: Node<T>;
  last?: Node<T>;

  push = (item: T) => {
    const node = new Node(item);

    if (!this.root || !this.last) {
      this.root = node;
      this.last = this.root;
    } else {
      const prevLast = this.last;

      this.last = node;

      prevLast.next = this.last;
    }
  };

  pop = () => {
    if (!this.root) {
      return null;
    }

    const prevRoot = this.root;

    this.root = prevRoot.next;

    return prevRoot.value;
  };

  get hasItems() {
    return !!this.root;
  }
}
