int function main() {
    int x = 5;
    int y = 6;
    int z = x;
    string hello = "Hello World";
    int sum = add(x, y);
    while(sum < 15) {
        if(sum > 13) {
            break;
        }
        sum = sum + 1;
    }
    for(int i = 0; i < 15; i++) {
        if(sum > 12) {
            break;
        }else{
            continue;
        }
    }
    boolean bool = true;
    while(bool) {
        if(bool) {
            bool = false;
        }else{
            continue;
        }
    }
    x = 2;
    int w = x + y;
    sum = add(add(x, y), w);
    if(sum > 15) {
        hello = "this is greater than 15";
    }else if(sum > 10) {
        hello = "this is greater than 10";
    }else if(sum > 5) {
        hello = "this is greater than 5";
    }else{
        hello = "this is less than 5";
    }
}

int function add(int x, int y) {
    return x + y;
}
